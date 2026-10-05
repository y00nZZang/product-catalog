import { config } from "../../src/config";
import { test, after } from "node:test";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start } from "../../src/server";
import { pool } from "../../src/persistence/connection";
import { emptyProduct } from "../../src/domain";
after(() => pool.end());
test("HTTP auth, validation, quote persistence, and runtime records", async () => {
  const app = await start();
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer integration-only-access-token-123",
  };
  try {
    assert.equal((await fetch(base + "/api/health")).status, 401);
    assert.equal((await fetch(base + "/api/health", { headers })).status, 200);
    assert.equal(
      (
        await fetch(base + "/api/analyses", {
          method: "POST",
          headers,
          body: JSON.stringify({ url: 1 }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/analyses", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.test" },
          body: JSON.stringify({ url: "https://jp.mercari.com/item/m1" }),
        })
      ).status,
      403,
    );
    const invalid = await (
      await fetch(base + "/api/analyses", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: "https://127.0.0.1/private" }),
      })
    ).json();
    assert.equal(invalid.status, "failed");
    const listing = randomUUID(),
      obs = randomUUID();
    await pool.query(
      "INSERT INTO listings(id,cache_key,platform,external_id,canonical_url)VALUES($1,$2,'rakuten','http:test','https://books.rakuten.co.jp/rb/123/')",
      [listing, randomUUID()],
    );
    await pool.query(
      "INSERT INTO observations(id,listing_id,expires_at,data,parser_version,content_hash) VALUES($1,$2,now()+interval '1 hour',$3,'test','test')",
      [
        obs,
        listing,
        JSON.stringify({
          ...emptyProduct(),
          title: "Album",
          price: 5672,
          currency: "JPY",
        }),
      ],
    );
    for (const baseCurrency of ["JPY", "USD"])
      await pool.query(
        "INSERT INTO fx_rates(base,data) VALUES($1,$2) ON CONFLICT(base) DO UPDATE SET data=EXCLUDED.data,fetched_at=now()",
        [
          baseCurrency,
          JSON.stringify({
            base: baseCurrency,
            quote: "KRW",
            rate: baseCurrency === "JPY" ? 9 : 1400,
            date: "2026-09-22",
            source: "synthetic",
          }),
        ],
      );
    const pkg = {
      weightGrams: 250,
      lengthCm: 19,
      widthCm: 14,
      heightCm: 2,
      basis: "user_assumption",
      source: "test",
    };
    const response = await fetch(base + `/api/listings/${listing}/quotes`, {
      method: "POST",
      headers,
      body: JSON.stringify(pkg),
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.quotes[0].knownSubtotal, 1800);
    assert.equal(data.quotes[1].knownSubtotal, 15.63);
    assert.equal(data.comparisonReady, false);
    const run = await (
      await fetch(base + "/api/analyses/" + data.runId, { headers })
    ).json();
    assert.equal(run.request.status, "succeeded");
    assert.equal(run.steps[0].stage, "quote");
    assert.ok(run.steps[0].duration_ms >= 0);
    const invalidBasis = await fetch(base + `/api/listings/${listing}/quotes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...pkg, basis: "verified" }),
    });
    assert.equal(invalidBasis.status, 400);
  } finally {
    await app.close();
  }
});

test("trusted HTTPS proxy preserves same-origin checks", async () => {
  const before = config.trustProxy;
  config.trustProxy = true;
  const app = await start();
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer integration-only-access-token-123",
    "X-Forwarded-Proto": "https",
  };
  try {
    const same = await fetch(base + "/api/analyses", {
      method: "POST",
      headers: { ...headers, Origin: base.replace("http:", "https:") },
      body: JSON.stringify({ url: 1 }),
    });
    assert.equal(same.status, 400); // Validation reached; not rejected as a forged origin.
    const other = await fetch(base + "/api/analyses", {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.test" },
      body: JSON.stringify({ url: 1 }),
    });
    assert.equal(other.status, 403);
  } finally {
    await app.close();
    config.trustProxy = before;
  }
});

test("explicit public access needs no bearer token while preserving origin validation", async () => {
  const previous = config.publicAccess;
  config.publicAccess = true;
  const app = await start();
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + "/api/health")).status, 200);
    assert.equal((await fetch(base + "/api/listings")).status, 200);
    const validOrigin = await fetch(base + "/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ url: 1 }),
    });
    assert.equal(validOrigin.status, 400);
    const badOrigin = await fetch(base + "/api/analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.test",
      },
      body: JSON.stringify({ url: 1 }),
    });
    assert.equal(badOrigin.status, 403);
  } finally {
    await app.close();
    config.publicAccess = previous;
  }
});
