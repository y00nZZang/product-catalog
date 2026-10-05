import { pool } from "../../src/persistence/connection";
(async () => {
  const runs =
    await pool.query(`SELECT r.environment,r.region,l.platform,r.kind,r.status,r.cache_hit,
 EXISTS(SELECT 1 FROM analysis_steps s WHERE s.run_id=r.id AND s.provider='openai') llm_attempted,
 count(*)::int samples,count(r.total_ms)::int measured_samples,
 percentile_cont(.5) WITHIN GROUP(ORDER BY r.total_ms) p50_ms,
 percentile_cont(.95) WITHIN GROUP(ORDER BY r.total_ms) p95_ms
 FROM analysis_runs r LEFT JOIN listings l ON l.id=r.listing_id
 GROUP BY r.environment,r.region,l.platform,r.kind,r.status,r.cache_hit,llm_attempted`);
  const steps =
    await pool.query(`SELECT r.environment,r.region,l.platform,s.stage,s.method,s.provider,s.status,count(*)::int samples,
 count(s.duration_ms)::int measured_samples,percentile_cont(.5) WITHIN GROUP(ORDER BY s.duration_ms) p50_ms,
 percentile_cont(.95) WITHIN GROUP(ORDER BY s.duration_ms) p95_ms,sum(s.cost_usd) estimated_cost_usd
 FROM analysis_steps s JOIN analysis_runs r ON r.id=s.run_id LEFT JOIN listings l ON l.id=r.listing_id
 GROUP BY r.environment,r.region,l.platform,s.stage,s.method,s.provider,s.status`);
  const quality = await pool.query(`SELECT count(*)::int observations,
 count(*) FILTER(WHERE data->>'title' IS NOT NULL AND data->>'price' IS NOT NULL AND data->>'currency' IS NOT NULL)::int title_price_currency_present
 FROM observations`);
  console.log(
    JSON.stringify(
      {
        runs: runs.rows,
        steps: steps.rows,
        quality: quality.rows[0],
        note: "Presence is not correctness. Small live smoke samples do not establish enterprise performance. Costs are provider-call estimates, not hosting or actual billing.",
      },
      null,
      2,
    ),
  );
  await pool.end();
})().catch(() => {
  console.error("Metrics query failed");
  process.exitCode = 1;
  pool.end();
});
