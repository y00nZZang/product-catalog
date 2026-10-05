import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../src/persistence/connection";
import { submit, getRun } from "../../src/persistence/catalog.repository";
import { recover } from "../../src/persistence/job-queue.repository";

import { Recorder } from "../../src/jobs/recorder";

const ids: string[] = [];
after(async () => {
  for (const id of ids) {
    await pool.query(
      "DELETE FROM analysis_steps WHERE run_id IN(SELECT id FROM analysis_runs WHERE listing_id=$1)",
      [id],
    );
    await pool.query(
      "UPDATE analysis_runs SET observation_id=NULL WHERE listing_id=$1",
      [id],
    );
    await pool.query(
      "DELETE FROM analysis_runs WHERE listing_id=$1 AND shared_run_id IS NOT NULL",
      [id],
    );
    await pool.query("DELETE FROM analysis_runs WHERE listing_id=$1", [id]);
    await pool.query("DELETE FROM observations WHERE listing_id=$1", [id]);
    await pool.query("DELETE FROM listings WHERE id=$1", [id]);
  }
  await pool.end();
});
test("PostgreSQL concurrent dedupe, cache TTL, timing, and abandoned lease recovery", async () => {
  const suffix = Date.now();
  const url = `https://item.rakuten.co.jp/fixture/album-${suffix}/`;
  const requests = await Promise.all(
    Array.from({ length: 12 }, () => submit(url)),
  );
  const listingId = (requests[0] as any).listingId;
  ids.push(listingId);
  assert.equal(requests.filter((r) => r.status === "queued").length, 1);
  assert.equal(requests.filter((r) => r.status === "waiting").length, 11);
  const owner = requests.find((r) => r.status === "queued")!.runId;
  await pool.query(
    "UPDATE analysis_runs SET status='succeeded',finished_at=now() WHERE id=$1",
    [owner],
  );
  await pool.query(
    "UPDATE analysis_runs SET status='succeeded',finished_at=now() WHERE shared_run_id=$1",
    [owner],
  );
  const obs = randomUUID();
  await pool.query(
    "INSERT INTO observations(id,listing_id,expires_at,data,parser_version,content_hash) VALUES($1,$2,now()+interval '1 hour','{}','test','test')",
    [obs, listingId],
  );
  const cached = await submit(url);
  assert.equal((cached as any).cacheHit, true);
  const cr = await getRun(cached.runId);
  assert.equal(cr.steps.length, 0);
  assert.ok(cr.request.total_ms >= 0);
  assert.equal(cr.request.observation_id, obs);
  await pool.query(
    "UPDATE observations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [obs],
  );
  const next = await submit(url);
  assert.equal(next.status, "queued");
  const other = await submit(
    `https://item.rakuten.co.jp/fixture/album-${suffix}/?option=blue`,
  );
  ids.push((other as any).listingId);
  assert.notEqual((other as any).listingId, listingId);
  await pool.query(
    "UPDATE analysis_runs SET status='running',attempt=1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",
    [next.runId, randomUUID()],
  );
  const step = randomUUID();
  await pool.query(
    "INSERT INTO analysis_steps(id,run_id,stage,attempt,status) VALUES($1,$2,'fetch',1,'running')",
    [step, next.runId],
  );
  await recover();
  const recovered = await getRun(next.runId);
  assert.equal(recovered.work.status, "queued");
  assert.equal(recovered.steps[0].status, "interrupted");
  assert.equal(recovered.steps[0].duration_ms, null);
  assert.equal(recovered.steps[0].finished_at, null);
  const rec = new Recorder(owner);
  await Promise.all([
    rec.step(
      "parse",
      "test",
      null,
      async () => new Promise((r) => setTimeout(r, 20)),
    ),
    rec.step(
      "quote",
      "test",
      null,
      async () => new Promise((r) => setTimeout(r, 30)),
    ),
  ]);
  await assert.rejects(
    rec.step("fetch", "test", null, async () => {
      throw new Error("failure");
    }),
  );
  const timed = await getRun(owner);
  assert.equal(
    timed.steps.filter((s: any) => s.status === "succeeded").length,
    2,
  );
  assert.equal(timed.steps.filter((s: any) => s.status === "failed").length, 1);
  assert.ok(timed.steps.every((s: any) => s.duration_ms >= 0));
});
