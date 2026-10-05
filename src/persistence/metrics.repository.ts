import { pool } from "./connection";

export async function checkDatabase() {
  await pool.query("SELECT 1");
}
export async function readMetrics() {
  return (
    await pool.query(`SELECT r.environment,r.region,l.platform,r.kind,r.cache_hit,r.status,count(*)::int AS samples,
 percentile_cont(0.5) WITHIN GROUP(ORDER BY r.total_ms) AS p50_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY r.total_ms) AS p95_ms
 FROM analysis_runs r LEFT JOIN listings l ON l.id=r.listing_id GROUP BY r.environment,r.region,l.platform,r.kind,r.cache_hit,r.status ORDER BY samples DESC`)
  ).rows;
}
