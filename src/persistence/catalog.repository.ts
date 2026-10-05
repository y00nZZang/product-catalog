import { enqueueAutomaticTax } from "./customs-auto.repository";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";
import { identify, errorCode, CatalogError } from "../domain";
export async function submit(url: string, refresh = false) {
  const started = performance.now();
  const runId = randomUUID();
  let id;
  try {
    id = identify(url);
  } catch (e) {
    await pool.query(
      "INSERT INTO analysis_runs(id,kind,status,finished_at,total_ms,error_type,environment,region) VALUES($1,'request','failed',now(),$2,$3,$4,$5)",
      [
        runId,
        performance.now() - started,
        errorCode(e),
        config.environment,
        config.region,
      ],
    );
    return { runId, status: "failed", error: errorCode(e) };
  }
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      id.key,
    ]);
    const listing = (
      await c.query(
        "INSERT INTO listings(id,cache_key,platform,external_id,canonical_url,options) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(cache_key) DO UPDATE SET cache_key=EXCLUDED.cache_key RETURNING *",
        [
          randomUUID(),
          id.key,
          id.platform,
          id.externalId,
          id.canonicalUrl,
          id.options,
        ],
      )
    ).rows[0];
    const cached = (
      await c.query(
        "SELECT id FROM observations WHERE listing_id=$1 AND expires_at>now() ORDER BY observed_at DESC LIMIT 1",
        [listing.id],
      )
    ).rows[0];
    if (cached && !refresh) {
      await c.query(
        "INSERT INTO analysis_runs(id,kind,listing_id,observation_id,status,cache_hit,started_at,finished_at,queue_ms,processing_ms,total_ms,environment,region) VALUES($1,'request',$2,$3,'succeeded',true,now(),now(),0,$4,$4,$5,$6)",
        [
          runId,
          listing.id,
          cached.id,
          performance.now() - started,
          config.environment,
          config.region,
        ],
      );
      await enqueueAutomaticTax(c, listing.id, cached.id);
      return {
        runId,
        listingId: listing.id,
        status: "succeeded",
        cacheHit: true,
      };
    }
    const shared = (
      await c.query(
        "SELECT id FROM analysis_runs WHERE listing_id=$1 AND kind='collect' AND status IN ('queued','running')",
        [listing.id],
      )
    ).rows[0];
    if (shared) {
      await c.query(
        "INSERT INTO analysis_runs(id,kind,listing_id,shared_run_id,status,environment,region) VALUES($1,'request',$2,$3,'waiting',$4,$5)",
        [runId, listing.id, shared.id, config.environment, config.region],
      );
      return {
        runId,
        listingId: listing.id,
        status: "waiting",
        sharedRunId: shared.id,
      };
    }
    await c.query(
      "INSERT INTO analysis_runs(id,kind,listing_id,status,environment,region) VALUES($1,'collect',$2,'queued',$3,$4)",
      [runId, listing.id, config.environment, config.region],
    );
    return { runId, listingId: listing.id, status: "queued" };
  });
}
export async function getRun(runId: string) {
  const run = (
    await pool.query("SELECT * FROM analysis_runs WHERE id=$1", [runId])
  ).rows[0];
  if (!run) throw new CatalogError("not_found");
  const owner = run.shared_run_id || run.id;
  const work = run.shared_run_id
    ? (await pool.query("SELECT * FROM analysis_runs WHERE id=$1", [owner]))
        .rows[0]
    : run;
  const steps = (
    await pool.query(
      "SELECT * FROM analysis_steps WHERE run_id=$1 ORDER BY started_at",
      [owner],
    )
  ).rows;
  return {
    request: run,
    work,
    steps,
    result: run.listing_id
      ? await getListing(run.listing_id, work.observation_id)
      : null,
  };
}
export async function getListing(id: string, observationId?: string) {
  const listing = (await pool.query("SELECT * FROM listings WHERE id=$1", [id]))
    .rows[0];
  if (!listing) throw new CatalogError("not_found");
  const obs =
    (
      await pool.query(
        "SELECT *,expires_at<now() AS stale FROM observations WHERE listing_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY observed_at DESC LIMIT 1",
        [id, observationId || null],
      )
    ).rows[0] || null;
  const quote =
    (
      await pool.query(
        "SELECT * FROM quotes WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1",
        [id],
      )
    ).rows[0] || null;
  const logistics =
    (
      await pool.query(
        "SELECT * FROM logistics WHERE listing_id=$1 AND observation_id=$2 ORDER BY created_at DESC LIMIT 1",
        [id, obs?.id || null],
      )
    ).rows[0] || null;
  const latest =
    (
      await pool.query(
        "SELECT id,status,error_type,requested_at FROM analysis_runs WHERE listing_id=$1 AND kind='collect' ORDER BY requested_at DESC LIMIT 1",
        [id],
      )
    ).rows[0] || null;
  return {
    listing,
    observation: obs,
    logistics,
    quote: quote
      ? { ...quote, stale: quote.observation_id !== obs?.id || obs?.stale }
      : null,
    latestCollection: latest,
  };
}

export async function listListings() {
  return (
    await pool.query(
      `SELECT l.*,o.data->>'title' title,o.observed_at,o.expires_at FROM listings l LEFT JOIN LATERAL(SELECT * FROM observations WHERE listing_id=l.id ORDER BY observed_at DESC LIMIT 1)o ON true ORDER BY l.created_at DESC LIMIT 50`,
    )
  ).rows;
}
