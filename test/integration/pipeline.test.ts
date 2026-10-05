import { publishCollectionPreview } from "../../src/persistence/collection.repository";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/persistence/connection";
import { submit, getRun } from "../../src/persistence/catalog.repository";
import { recover } from "../../src/persistence/job-queue.repository";
import { claimJob as claim } from "../support/jobs";
import { collect } from "../../src/ingestion/collector";
import { config } from "../../src/config";
import { CatalogError } from "../../src/domain";
after(() => pool.end());
const html =
  '<h1>Regression Blu-ray</h1><span itemprop="price" content="1000"></span><meta itemprop="priceCurrency" content="JPY">';
const success: any = async () => ({
  html,
  url: "https://books.rakuten.co.jp/rb/99000001/",
  status: 200,
  contentType: "text/html",
});
const fx: any = async () => ({
  base: "JPY",
  quote: "KRW",
  rate: 9,
  date: "2026-09-22",
  source: "synthetic",
  retrievedAt: new Date().toISOString(),
});
async function ready() {
  await pool.query(
    "UPDATE site_state SET next_allowed_at=now(),active_until=NULL,owner=NULL,paused_until=NULL",
  );
}
test("real queue pipeline persists partial data, shares work, and keeps stale values on failed refresh", async () => {
  await ready();
  const a: any = await submit("https://books.rakuten.co.jp/rb/99000001/");
  const b: any = await submit(
    "https://books.rakuten.co.jp/rb/99000001/?utm_source=another",
  );
  let run = await claim();
  assert.equal(run.id, a.runId);
  await collect(run, { fetcher: success, fxGetter: fx });
  const done = await getRun(a.runId);
  assert.equal(done.work.status, "succeeded");
  assert.equal(done.result!.observation.data.price, 1000);
  assert.equal(done.result!.observation.data.availability, "unknown");
  assert.equal((await getRun(b.runId)).request.status, "succeeded");
  await pool.query(
    "UPDATE observations SET expires_at=now()-interval '1 second' WHERE listing_id=$1",
    [a.listingId],
  );
  await ready();
  const retry: any = await submit("https://books.rakuten.co.jp/rb/99000001/");
  run = await claim();
  await collect(run, {
    fetcher: async () => {
      throw new CatalogError("access_denied");
    },
    fxGetter: fx,
  });
  const failed = await getRun(retry.runId);
  assert.equal(failed.work.status, "failed");
  assert.equal(failed.result!.observation.data.price, 1000);
  assert.equal(failed.result!.observation.stale, true);
});
test("429 honors Retry-After; finite retries; stale worker token cannot publish", async () => {
  await ready();
  const a: any = await submit("https://jp.mercari.com/item/m99000002");
  let run = await claim();
  assert.equal(run.id, a.runId);
  const started = Date.now();
  await collect(run, {
    fetcher: async () => {
      throw new CatalogError("rate_limited", true, 120000);
    },
  });
  let state = await getRun(a.runId);
  assert.equal(state.work.status, "queued");
  assert.ok(new Date(state.work.available_at).getTime() - started >= 119000);
  await pool.query(
    "UPDATE analysis_runs SET available_at=now(),attempt=2 WHERE id=$1",
    [a.runId],
  );
  await ready();
  run = await claim();
  await collect(run, {
    fetcher: async () => {
      throw new CatalogError("upstream_error", true);
    },
  });
  state = await getRun(a.runId);
  assert.equal(state.work.status, "failed");
  assert.equal(state.work.attempt, 3);
  const b: any = await submit("https://jp.mercari.com/item/m99000003");
  await ready();
  run = await claim();
  await pool.query(
    "UPDATE analysis_runs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [b.runId],
  );
  await recover();
  await collect(run, { fetcher: success, fxGetter: fx });
  const recovered = await getRun(b.runId);
  assert.equal(recovered.work.status, "queued");
  assert.equal(recovered.result!.observation, null);
});

test("automatic multimodal proposal persists ranges without approving or creating a quote", async () => {
  const was = config.llm;
  config.llm = true;
  try {
    await ready();
    const request: any = await submit(
      "https://books.rakuten.co.jp/rb/99000009/",
    );
    await pool.query(
      "UPDATE analysis_runs SET available_at=now()+interval '1 hour' WHERE status='queued' AND id<>$1",
      [request.runId],
    );
    const run = await claim();
    const proposal = {
      package: {
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
        basis: "estimated" as const,
        source: "fixture",
        assumptions: ["comparable"],
      },
      requiresReview: true,
      reason: "ai_proposal_ready",
      sources: [],
      ranges: { weightGrams: { low: 300, typical: 500, high: 700 } },
    };
    await collect(run, {
      fetcher: success,
      fxGetter: fx,
      ai: {
        supplement: async (p) => p,
        researchPackage: async (product) => {
          const inFlight = await getRun(request.runId);
          assert.equal(inFlight.work.status, "running");
          assert.equal(inFlight.work.preview.product.title, product.title);
          assert.equal(inFlight.result!.observation, null);
          await assert.rejects(
            publishCollectionPreview(
              { ...run, lease_token: "00000000-0000-0000-0000-000000000000" },
              product,
              new Date(),
            ),
            (e: any) => e.code === "lease_lost",
          );
          return proposal as any;
        },
      },
    });
    const result = await getRun(request.runId);
    assert.equal(result.work.status, "succeeded");
    assert.equal(result.result!.logistics.data.ranges.weightGrams.high, 700);
    assert.equal(result.result!.logistics.data.requiresReview, true);
    assert.equal(result.result!.quote, null);
  } finally {
    config.llm = was;
  }
});
