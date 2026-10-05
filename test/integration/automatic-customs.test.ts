import { randomUUID } from "node:crypto";
import { completeTaxRun } from "../../src/persistence/customs.repository";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import { config } from "../../src/config";
import { submit, getRun } from "../../src/persistence/catalog.repository";
import {
  getCustoms,
  requestTaxRun,
} from "../../src/persistence/customs.repository";
import { collect } from "../../src/ingestion/collector";
import { analyzeTax } from "../../src/customs/service";
import { claimJob } from "../support/jobs";
import {
  getCustomsFx,
  koreaDate,
  weekStart,
  parsePublicFx,
} from "../../src/customs/fx";
import { readFileSync } from "node:fs";
after(() => pool.end());
test("collection completion atomically queues automatic customs and cache-hit URL requests reuse it", async () => {
  const prev = config.autoCustoms;
  config.autoCustoms = true;
  try {
    const r: any = await submit("https://books.rakuten.co.jp/rb/99100001/");
    await pool.query(
      "UPDATE analysis_runs SET available_at=now()+interval '1 hour' WHERE status='queued' AND id<>$1",
      [r.runId],
    );
    await pool.query(
      "UPDATE site_state SET active_until=NULL,owner=NULL,next_allowed_at=now(),paused_until=NULL",
    );
    const run = await claimJob();
    await collect(run, {
      fetcher: async () => ({
        html: '<h1>CD DVD Album</h1><span itemprop="price" content="30000"></span><meta itemprop="priceCurrency" content="JPY">',
        status: 200,
        url: run.canonical_url,
        contentType: "text/html",
      }),
      fxGetter: async () => ({
        base: "JPY",
        quote: "KRW",
        rate: 10,
        date: "2026-10-01",
        source: "fixture",
        retrievedAt: "2026-10-01T00:00:00Z",
      }),
    });
    const obs = (await getRun(r.runId)).result!.observation;
    const jobs = (
      await pool.query(
        "SELECT * FROM analysis_runs WHERE kind='tax_analysis' AND listing_id=$1",
        [r.listingId],
      )
    ).rows;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].observation_id, obs.id);
    const repeats = await Promise.all(
      Array.from({ length: 5 }, () => requestTaxRun(r.listingId, "", true)),
    );
    assert.ok(repeats.every((x) => x.runId === jobs[0].id));
    await submit("https://books.rakuten.co.jp/rb/99100001/");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM analysis_runs WHERE kind='tax_analysis' AND listing_id=$1",
          [r.listingId],
        )
      ).rows[0].n,
      1,
    );
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL",
    );
    const tax = await claimJob();
    assert.equal(tax.kind, "tax_analysis");
    const from = weekStart(koreaDate()),
      to = new Date(Date.parse(from) + 6 * 86400000).toISOString().slice(0, 10);
    const outcome = await analyzeTax(
      tax,
      {
        call: async () => {
          throw Error("No paid model request expected");
        },
      },
      async () => ({
        jpyToKrw: "10",
        usdToKrw: "1000",
        validFrom: from,
        validTo: to,
        referenceDate: koreaDate(),
        source: "https://example.test",
        sourceKind: "official_api",
        retrievedAt: new Date().toISOString(),
        warnings: [],
      }),
    );
    assert.equal(outcome.status, "succeeded");
    const result = await getCustoms(r.listingId);
    assert.ok(result.automatic);
    assert.equal(result.automaticFresh, true);
    assert.equal(result.estimate, null);
    assert.equal(result.automatic.data.requiresReview, true);
    // A shipping edit arriving after a worker took its snapshot must leave a successor job.
    const l2 = randomUUID();
    await pool.query(
      "INSERT INTO logistics(id,listing_id,observation_id,run_id,data)VALUES($1,$2,$3,$4,'{}')",
      [l2, r.listingId, obs.id, run.id],
    );
    const next = await requestTaxRun(r.listingId, "", true);
    await pool.query(
      "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL",
    );
    const claimed = await claimJob();
    assert.equal(claimed.id, next.runId);
    await pool.query(
      "INSERT INTO logistics(id,listing_id,observation_id,run_id,data)VALUES($1,$2,$3,$4,'{}')",
      [randomUUID(), r.listingId, obs.id, run.id],
    );
    await completeTaxRun(
      claimed,
      result.classification.data,
      performance.now(),
      { ...result.automatic.data, logisticsId: l2 },
    );
    const pending = (
      await pool.query(
        "SELECT id FROM analysis_runs WHERE listing_id=$1 AND kind='tax_analysis' AND status='queued'",
        [r.listingId],
      )
    ).rows;
    assert.equal(pending.length, 1);
    assert.notEqual(pending[0].id, claimed.id);
    await pool.query(
      "UPDATE analysis_runs SET status='interrupted' WHERE id=$1",
      [pending[0].id],
    );
  } finally {
    config.autoCustoms = prev;
  }
});
test("customs FX public fallback is shared and cached, and stores no upstream session fields", async () => {
  const old = process.env.CUSTOMS_API_KEY;
  delete process.env.CUSTOMS_API_KEY;
  try {
    await pool.query("DELETE FROM customs_fx");
    let calls = 0;
    const html = readFileSync(
        "test/fixtures/customs-fx/public-2026-10-01.html",
        "utf8",
      ),
      json = JSON.parse(
        readFileSync("test/fixtures/customs-fx/public-2026-10-01.json", "utf8"),
      );
    json.items[0].ssUserIp = "DO_NOT_PERSIST";
    const fetcher: any = async (url: string) => {
      calls++;
      return {
        html: url.includes("retrieveCOM") ? JSON.stringify(json) : html,
      };
    };
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => getCustomsFx("2026-10-01", fetcher)),
    );
    assert.equal(calls, 2);
    assert.ok(rows.every((r) => r.jpyToKrw === "8.7484"));
    await getCustomsFx("2026-10-01", fetcher);
    assert.equal(calls, 2);
    assert.equal(
      JSON.stringify(
        (await pool.query("SELECT data FROM customs_fx")).rows,
      ).includes("DO_NOT_PERSIST"),
      false,
    );
    assert.equal(
      parsePublicFx(html, json, "2026-10-01").sourceKind,
      "official_public",
    );
  } finally {
    if (old === undefined) delete process.env.CUSTOMS_API_KEY;
    else process.env.CUSTOMS_API_KEY = old;
  }
});

test("configured OpenAPI is preferred on cache miss and credentials never enter FX records", async () => {
  const old = process.env.CUSTOMS_API_KEY;
  process.env.CUSTOMS_API_KEY = "fixture-key-do-not-persist";
  try {
    await pool.query("DELETE FROM customs_fx");
    const xml =
      "<response><resultCode>00</resultCode><item><currSgn>JPY</currSgn><aplyBgnDt>20260927</aplyBgnDt><fxrt>8.7484</fxrt><imexTp>2</imexTp></item><item><currSgn>USD</currSgn><aplyBgnDt>20260927</aplyBgnDt><fxrt>1376.03</fxrt><imexTp>2</imexTp></item></response>";
    let calls = 0;
    const fetcher: any = async (raw: string) => {
      calls++;
      const u = new URL(raw);
      assert.equal(u.hostname, "apis.data.go.kr");
      assert.equal(u.searchParams.get("weekFxrtTpcd"), "2");
      assert.equal(
        u.searchParams.get("serviceKey"),
        "fixture-key-do-not-persist",
      );
      return { html: xml };
    };
    const fx = await getCustomsFx("2026-10-01", fetcher);
    assert.equal(fx.sourceKind, "official_api");
    assert.equal(calls, 1);
    assert.equal(
      JSON.stringify(
        (await pool.query("SELECT data FROM customs_fx")).rows,
      ).includes("fixture-key-do-not-persist"),
      false,
    );
    await pool.query("DELETE FROM customs_fx");
    const html = readFileSync(
        "test/fixtures/customs-fx/public-2026-10-01.html",
        "utf8",
      ),
      json = readFileSync(
        "test/fixtures/customs-fx/public-2026-10-01.json",
        "utf8",
      );
    const failed: any = async (raw: string) => {
      if (raw.includes("apis.data.go.kr"))
        throw Error("fixture-key-do-not-persist");
      return { html: raw.includes("retrieveCOM") ? json : html };
    };
    const fallback = await getCustomsFx("2026-10-01", failed);
    assert.equal(fallback.sourceKind, "official_public");
    assert.equal(fallback.warnings.length, 1);
    assert.equal(
      JSON.stringify(fallback).includes("fixture-key-do-not-persist"),
      false,
    );
  } finally {
    if (old === undefined) delete process.env.CUSTOMS_API_KEY;
    else process.env.CUSTOMS_API_KEY = old;
  }
});
