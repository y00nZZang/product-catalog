import { enqueueAutomaticTax } from "./customs-auto.repository";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";
import {
  CatalogError,
  errorCode,
  ttlSeconds,
  type Product,
  type Identity,
  type ClaimedRun,
  type PackageResearchResult,
  type QuoteComparison,
} from "../domain";

export async function previousProduct(
  listingId: string,
): Promise<Product | undefined> {
  return (
    await pool.query<{ data: Product }>(
      "SELECT data FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
      [listingId],
    )
  ).rows[0]?.data;
}
export interface CollectionCommit {
  observationId: string;
  identity: Identity;
  product: Product;
  specs: PackageResearchResult;
  quote: QuoteComparison | null;
  observedAt: Date;
  contentHash: string;
  parserVersion: string;
  processingStartedAt: number;
}
/** Keep observation, quote, shared-request completion and site release in ONE transaction.
 * The lease token is checked before any writes so a recovered worker cannot publish stale data. */
export async function commitCollection(
  run: ClaimedRun,
  result: CollectionCommit,
) {
  const {
    observationId: obsId,
    identity: id,
    product: p,
    specs,
    quote,
    observedAt,
    contentHash,
    parserVersion,
    processingStartedAt: start,
  } = result;
  await tx(async (c) => {
    const owned = (
      await c.query(
        "SELECT id FROM analysis_runs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
        [run.id, run.lease_token],
      )
    ).rowCount;
    if (!owned) throw new CatalogError("lease_lost");
    await c.query(
      "INSERT INTO observations(id,listing_id,observed_at,expires_at,data,parser_version,content_hash) VALUES($1,$2,$7,$7::timestamptz+$3*interval '1 second',$4,$5,$6)",
      [
        obsId,
        run.listing_id,
        ttlSeconds(id.platform),
        JSON.stringify(p),
        parserVersion,
        contentHash,
        observedAt,
      ],
    );
    await c.query(
      "INSERT INTO logistics(id,listing_id,observation_id,run_id,data) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), run.listing_id, obsId, run.id, JSON.stringify(specs)],
    );
    await enqueueAutomaticTax(c, run.listing_id, obsId);
    if (quote)
      await c.query(
        "INSERT INTO quotes(id,listing_id,observation_id,run_id,data) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), run.listing_id, obsId, run.id, JSON.stringify(quote)],
      );
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',observation_id=$2,finished_at=now(),processing_ms=CASE WHEN processing_complete THEN COALESCE(processing_ms,0)+$3 ELSE NULL END,total_ms=extract(epoch FROM(now()-requested_at))*1000,error_type=NULL,warnings=$4,lease_until=NULL WHERE id=$1",
      [run.id, obsId, performance.now() - start, JSON.stringify(p!.warnings)],
    );
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',observation_id=$2,finished_at=now(),total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE shared_run_id=$1 AND status='waiting'",
      [run.id, obsId],
    );
    await c.query(
      "UPDATE site_state SET active_until=NULL,owner=NULL,consecutive_blocks=0,next_allowed_at=now()+$3*interval '1 millisecond' WHERE platform=$1 AND owner=$2",
      [id.platform, run.lease_token, config.siteIntervalMs],
    );
  });
}
/** Retry policy and its persisted transition belong together; never discard a prior successful observation. */
export async function failCollection(
  run: ClaimedRun,
  e: unknown,
  start: number,
) {
  const code = errorCode(e);
  const delay = Math.max(
    e instanceof CatalogError ? e.retryAfterMs : 0,
    config.siteIntervalMs,
    1000 * 2 ** run.attempt,
  );
  const retry =
    e instanceof CatalogError &&
    e.retryable &&
    run.attempt < config.maxAttempts;
  await tx(async (c) => {
    const result = await c.query(
      "UPDATE analysis_runs SET status=$3,error_type=$4,available_at=now()+$5*interval '1 millisecond',finished_at=CASE WHEN $3='failed' THEN now() ELSE NULL END,processing_ms=CASE WHEN processing_complete THEN COALESCE(processing_ms,0)+$6 ELSE NULL END,total_ms=CASE WHEN $3='failed' THEN extract(epoch FROM(now()-requested_at))*1000 ELSE NULL END,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
      [
        run.id,
        run.lease_token,
        retry ? "queued" : "failed",
        code,
        delay,
        performance.now() - start,
      ],
    );
    if (!result.rowCount) return;
    if (!retry)
      await c.query(
        "UPDATE analysis_runs SET status='failed',error_type=$2,finished_at=now(),total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE shared_run_id=$1 AND status='waiting'",
        [run.id, code],
      );
    const blocked = ["access_denied", "challenge", "rate_limited"].includes(
      code,
    );
    await c.query(
      `UPDATE site_state SET active_until=NULL,owner=NULL,next_allowed_at=now()+$3*interval '1 millisecond',
    consecutive_blocks=CASE WHEN $4 THEN consecutive_blocks+1 ELSE 0 END,
    paused_until=CASE WHEN $4 AND consecutive_blocks>=2 THEN now()+interval '15 minutes' ELSE paused_until END
    WHERE platform=$1 AND owner=$2`,
      [run.platform, run.lease_token, delay, blocked],
    );
  });
  return { status: retry ? "queued" : "failed", error: code };
}

/** Publish only normalized product data, fenced to the current worker lease. */
export async function publishCollectionPreview(
  run: ClaimedRun,
  product: Product,
  observedAt: Date,
) {
  const updated = await pool.query(
    "UPDATE analysis_runs SET preview=$3 WHERE id=$1 AND lease_token=$2 AND status='running'",
    [
      run.id,
      run.lease_token,
      JSON.stringify({ product, observedAt, attempt: run.attempt }),
    ],
  );
  if (!updated.rowCount) throw new CatalogError("lease_lost");
}
