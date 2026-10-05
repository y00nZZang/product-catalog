import { tariffWindow } from "../customs/tariff/types";
import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { config } from "../config";
import { AUTO_TAX_VERSION } from "../customs/automatic";
import { TAX_VERSION } from "../customs/profiles";
import { weekStart, koreaDate } from "../customs/fx";
/** Transactional outbox: collection/packaging publication and follow-up tax job are atomic. */
export async function enqueueAutomaticTax(
  c: PoolClient,
  listingId: string,
  observationId: string,
) {
  if (!config.autoCustoms) return null;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,3))", [
    listingId,
  ]);
  const logistics = (
    await c.query(
      "SELECT id FROM logistics WHERE listing_id=$1 AND observation_id=$2 ORDER BY created_at DESC LIMIT 1",
      [listingId, observationId],
    )
  ).rows[0];
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        observationId,
        logistics?.id || null,
        weekStart(koreaDate()),
        tariffWindow(),
        koreaDate(),
        TAX_VERSION,
        AUTO_TAX_VERSION,
      ]),
    )
    .digest("hex");
  const reused = (
    await c.query(
      "SELECT r.id,r.status FROM analysis_runs r WHERE r.listing_id=$1 AND r.kind='tax_analysis' AND r.input->>'automaticKey'=$2 AND (r.status IN ('queued','running') OR r.finished_at>now()-interval '10 minutes' OR (r.status='succeeded' AND EXISTS(SELECT 1 FROM customs_results x WHERE x.run_id=r.id AND x.kind='estimate' AND x.data->>'status'='estimated'))) ORDER BY r.requested_at DESC LIMIT 1",
      [listingId, key],
    )
  ).rows[0];
  if (reused) return { runId: reused.id, shared: true, status: reused.status };
  const active = (
    await c.query(
      "SELECT id,status FROM analysis_runs WHERE listing_id=$1 AND kind='tax_analysis' AND status IN ('queued','running')",
      [listingId],
    )
  ).rows[0];
  if (active?.status === "running")
    return { runId: active.id, shared: true, status: active.status };
  if (active)
    await c.query(
      "UPDATE analysis_runs SET status='interrupted',error_type='superseded',finished_at=now() WHERE id=$1",
      [active.id],
    );
  const id = randomUUID();
  await c.query(
    "INSERT INTO analysis_runs(id,kind,listing_id,observation_id,status,input,environment,region)VALUES($1,'tax_analysis',$2,$3,'queued',$4,$5,$6)",
    [
      id,
      listingId,
      observationId,
      JSON.stringify({
        hint: "",
        automatic: true,
        automaticKey: key,
        logisticsId: logistics?.id || null,
      }),
      config.environment,
      config.region,
    ],
  );
  return { runId: id, shared: false, status: "queued" };
}
export async function latestTaxLogistics(
  c: Pool | PoolClient,
  listingId: string,
  observationId: string,
) {
  return (
    (
      await c.query(
        "SELECT id,data FROM logistics WHERE listing_id=$1 AND observation_id=$2 ORDER BY created_at DESC LIMIT 1",
        [listingId, observationId],
      )
    ).rows[0] || null
  );
}
