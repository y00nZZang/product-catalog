import { enqueueAutomaticTax } from "./customs-auto.repository";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";
import { CatalogError, type ClaimedRun, type Product } from "../domain";
/** Same-listing requests share only an identical observation and hint. */
export async function enqueuePackageAnalysis(listingId: string, hint: string) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [
      listingId,
    ]);
    if (
      (
        await c.query(
          "SELECT 1 FROM analysis_runs WHERE listing_id=$1 AND kind='collect' AND status IN ('queued','running')",
          [listingId],
        )
      ).rowCount
    )
      throw new CatalogError("collection_in_progress");
    const observation = (
      await c.query(
        "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0];
    if (!observation) throw new CatalogError("observation_required");
    const active = (
      await c.query(
        "SELECT id,observation_id,input FROM analysis_runs WHERE listing_id=$1 AND kind='package_analysis' AND status IN ('queued','running')",
        [listingId],
      )
    ).rows[0];
    if (active) {
      if (
        active.observation_id !== observation.id ||
        active.input.hint !== hint
      )
        throw new CatalogError("package_analysis_in_progress");
      return { runId: active.id, listingId, status: "queued", shared: true };
    }
    const id = randomUUID();
    await c.query(
      "INSERT INTO analysis_runs(id,kind,listing_id,observation_id,status,input,environment,region)VALUES($1,'package_analysis',$2,$3,'queued',$4,$5,$6)",
      [
        id,
        listingId,
        observation.id,
        JSON.stringify({ hint }),
        config.environment,
        config.region,
      ],
    );
    return { runId: id, listingId, status: "queued", shared: false };
  });
}
export async function readPackageObservation(
  run: ClaimedRun,
): Promise<Product> {
  const observation = (
    await pool.query(
      "SELECT data FROM observations WHERE id=$1 AND listing_id=$2",
      [run.observation_id, run.listing_id],
    )
  ).rows[0];
  if (!observation) throw new CatalogError("observation_required");
  const latest = (
    await pool.query(
      "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
      [run.listing_id],
    )
  ).rows[0];
  if (latest?.id !== run.observation_id)
    throw new CatalogError("package_observation_changed");
  return observation.data;
}
/** Fence publication with the lease; a proposal never creates or overwrites an approved quote. */
export async function commitPackageAnalysis(
  run: ClaimedRun,
  result: object,
  start: number,
) {
  await tx(async (c) => {
    if (
      !(
        await c.query(
          "SELECT id FROM analysis_runs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
          [run.id, run.lease_token],
        )
      ).rowCount
    )
      throw new CatalogError("lease_lost");
    await c.query(
      "INSERT INTO logistics(id,listing_id,observation_id,run_id,data)VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        run.listing_id,
        run.observation_id,
        run.id,
        JSON.stringify({
          ...result,
          hint: run.input.hint,
          origin: "manual_ai",
        }),
      ],
    );
    await enqueueAutomaticTax(c, run.listing_id, run.observation_id!);
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',finished_at=now(),processing_ms=$2,total_ms=extract(epoch FROM(now()-requested_at))*1000,lease_until=NULL WHERE id=$1",
      [run.id, performance.now() - start],
    );
  });
}
export async function failPackageAnalysis(
  run: ClaimedRun,
  error: string,
  start: number,
) {
  await pool.query(
    "UPDATE analysis_runs SET status='failed',error_type=$3,finished_at=now(),processing_ms=$4,total_ms=extract(epoch FROM(now()-requested_at))*1000,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",
    [run.id, run.lease_token, error, performance.now() - start],
  );
}
export async function releasePackageSite(run: ClaimedRun) {
  await pool.query(
    "UPDATE site_state SET active_until=NULL,owner=NULL WHERE platform=$1 AND owner=$2",
    [run.platform, run.lease_token],
  );
}
