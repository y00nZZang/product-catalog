/** Explicit paid smoke test against saved observations; no listing refresh or quote mutation. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pool } from "../../src/persistence/connection";
import { aiRequestKey } from "../../src/persistence/ai.repository";
import { config } from "../../src/config";
import type { ModelCaller } from "../../src/ai/executor";
import { AiService } from "../../src/ai/service";
import { Recorder } from "../../src/jobs/recorder";
import { identify, errorCode } from "../../src/domain";
async function main() {
  const cacheOnly = process.argv[2] === "--cache-only";
  if (!cacheOnly && process.argv[2] !== "--live")
    throw new Error("Explicit --live required; consumes configured AI budget");
  const ids = process.argv.slice(3);
  if (!ids.length || ids.length > 2)
    throw new Error("Supply one or two saved listing UUIDs");
  const rows = [];
  let cacheHits = 0;
  const cachedCaller: ModelCaller = {
    call: async (_rec, stage, _fn, material) => {
      const key = aiRequestKey(stage, config.model, material);
      const found = (
        await pool.query(
          "SELECT result FROM ai_requests WHERE cache_key=$1 AND status='succeeded' AND expires_at>now()",
          [key],
        )
      ).rows[0];
      if (!found) throw new Error("cache_missing_no_paid_fallback");
      cacheHits++;
      return found.result;
    },
  };
  for (const id of ids) {
    const r = (
      await pool.query(
        "SELECT l.canonical_url,o.data FROM listings l JOIN LATERAL (SELECT data FROM observations WHERE listing_id=l.id ORDER BY observed_at DESC LIMIT 1) o ON true WHERE l.id=$1",
        [id],
      )
    ).rows[0];
    if (!r) throw new Error("Saved listing required");
    const runId = randomUUID(),
      start = performance.now();
    await pool.query(
      "INSERT INTO analysis_runs(id,kind,status,started_at,environment,region) VALUES($1,'package_multimodal_verification','running',now(),'local_live_test','local')",
      [runId],
    );
    try {
      const result = await new AiService(
        cacheOnly ? cachedCaller : undefined,
      ).suggestPackage(r.data, identify(r.canonical_url), new Recorder(runId));
      rows.push({
        url: r.canonical_url,
        title: r.data.title,
        result,
        durationMs: performance.now() - start,
      });
      await pool.query(
        "UPDATE analysis_runs SET status='succeeded',finished_at=now(),processing_ms=$2 WHERE id=$1",
        [runId, performance.now() - start],
      );
    } catch (e) {
      rows.push({ url: r.canonical_url, error: errorCode(e) });
      await pool.query(
        "UPDATE analysis_runs SET status='failed',finished_at=now(),error_type=$2 WHERE id=$1",
        [runId, errorCode(e)],
      );
    }
  }
  const path =
    process.env.PACKAGE_VERIFICATION_REPORT ||
    (cacheOnly
      ? "docs/evidence/package-multimodal-cache-2026-09-29.json"
      : "docs/evidence/package-multimodal-local-2026-09-29.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        kind: cacheOnly
          ? "cache_only_no_paid_fallback"
          : "live_smoke_not_accuracy_evaluation",
        cacheHits,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        url: r.url,
        error: r.error,
        reason: r.result?.reason,
        imageCount: r.result?.imageCount,
        imageWarnings: r.result?.imageWarnings,
        package: r.result?.package,
        validationWarnings: r.result?.validationWarnings,
      })),
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(errorCode(e));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
