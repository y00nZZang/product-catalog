import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pool } from "../../src/persistence/connection";
import { start } from "../../src/server";
import { emptyProduct } from "../../src/domain";
import { claimJob } from "../support/jobs";
import { analyzeTax } from "../../src/customs/service";
after(() => pool.end());
test("customs API dedupes classifications, persists liquor taxes and rejects unconfirmed or stale classification", async () => {
  const app = await start(),
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer integration-only-access-token-123",
  };
  const listing = randomUUID(),
    obs = randomUUID();
  try {
    await pool.query(
      "INSERT INTO listings(id,cache_key,platform,external_id,canonical_url)VALUES($1,$2,'rakuten','tax:wine','https://item.rakuten.co.jp/test/wine/')",
      [listing, randomUUID()],
    );
    await pool.query(
      "INSERT INTO observations(id,listing_id,expires_at,data,parser_version,content_hash)VALUES($1,$2,now()+interval '1 hour',$3,'test','test')",
      [
        obs,
        listing,
        JSON.stringify({
          ...emptyProduct(),
          title: "ワイン 750ml アルコール14% 1本",
          description: "赤ワイン",
        }),
      ],
    );
    assert.equal(
      (await fetch(base + `/api/listings/${listing}/customs`)).status,
      401,
    );
    assert.equal(
      (await fetch(base + "/api/listings/tax-metadata", { headers })).status,
      200,
    );
    const post = async (path: string, body: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const requests = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const r = await post(`/api/listings/${listing}/tax-analysis`, {});
        assert.equal(r.status, 202);
        return r.json();
      }),
    );
    assert.equal(new Set(requests.map((r) => r.runId)).size, 1);
    await pool.query(
      "UPDATE analysis_runs SET available_at=now()+interval '1 hour' WHERE status='queued' AND id<>$1",
      [requests[0].runId],
    );
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),paused_until=NULL,active_until=NULL,owner=NULL",
    );
    const run = await claimJob();
    assert.equal(run.kind, "tax_analysis");
    await analyzeTax(run, {
      call: async () => {
        throw Error("No model request permitted for obvious wine");
      },
    });
    const saved = await (
      await fetch(base + `/api/listings/${listing}/customs`, { headers })
    ).json();
    assert.equal(saved.classification.data.candidates[0].profile, "wine");
    const input = {
      profile: "wine",
      confirmed: true,
      observationId: obs,
      classificationId: saved.classification.id,
      route: "express",
      personalUse: true,
      currency: "USD",
      goods: "100",
      domestic: "0",
      international: "0",
      insurance: "0",
      additions: "0",
      shippingSeparated: true,
      fx: {
        jpyToKrw: "10",
        usdToKrw: "1000",
        validFrom: "2026-09-27",
        validTo: "2026-10-03",
        referenceDate: "2026-09-30",
      },
      alcohol: { bottles: 1, mlPerBottle: 750, abv: 14 },
    };
    assert.equal(
      (
        await post(`/api/listings/${listing}/tax-quotes`, {
          ...input,
          confirmed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(`/api/listings/${listing}/tax-quotes`, {
          ...input,
          profile: "toy",
        })
      ).status,
      400,
    );
    const response = await post(`/api/listings/${listing}/tax-quotes`, input);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.totalTaxKrw, 33000);
    assert.equal(result.taxes.vat, 0);
    const stored = await (
      await fetch(base + `/api/listings/${listing}/customs`, { headers })
    ).json();
    assert.equal(stored.estimate.data.totalTaxKrw, 33000);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quotes WHERE listing_id=$1",
          [listing],
        )
      ).rows[0].n,
      0,
    );
    await pool.query(
      "UPDATE customs_results SET data=jsonb_set(data,'{version}','\"outdated\"'::jsonb) WHERE id=$1",
      [saved.classification.id],
    );
    assert.equal(
      (await post(`/api/listings/${listing}/tax-quotes`, input)).status,
      400,
    );
    const next = randomUUID();
    await pool.query(
      "INSERT INTO observations(id,listing_id,expires_at,data,parser_version,content_hash)VALUES($1,$2,now()+interval '1 hour',$3,'test','test')",
      [next, listing, JSON.stringify(emptyProduct())],
    );
    assert.equal(
      (await post(`/api/listings/${listing}/tax-quotes`, input)).status,
      400,
    );
  } finally {
    await app.close();
  }
});
