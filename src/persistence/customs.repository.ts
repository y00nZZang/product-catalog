import { tariffWindow } from "../customs/tariff/types";
import {
  enqueueAutomaticTax,
  latestTaxLogistics,
} from "./customs-auto.repository";
import { TAX_VERSION } from "../customs/profiles";
import { AUTO_TAX_VERSION } from "../customs/automatic";
import { weekStart, koreaDate } from "../customs/fx";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";
import { CatalogError, type ClaimedRun } from "../domain";
export async function requestTaxRun(
  listingId: string,
  hint: string,
  automatic = false,
) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,3))", [
      listingId,
    ]);
    const obs = (
      await c.query(
        "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0];
    if (!obs) throw new CatalogError("observation_required");
    if (automatic) {
      const queued = await enqueueAutomaticTax(c, listingId, obs.id);
      if (queued) return queued;
    }
    const active = (
      await c.query(
        "SELECT id,observation_id,input FROM analysis_runs WHERE listing_id=$1 AND kind='tax_analysis' AND status IN ('queued','running')",
        [listingId],
      )
    ).rows[0];
    if (active) {
      if (active.observation_id !== obs.id || active.input.hint !== hint)
        throw new CatalogError("tax_analysis_in_progress");
      return { runId: active.id, shared: true };
    }
    const id = randomUUID();
    await c.query(
      "INSERT INTO analysis_runs(id,kind,listing_id,observation_id,status,input,environment,region)VALUES($1,'tax_analysis',$2,$3,'queued',$4,$5,$6)",
      [
        id,
        listingId,
        obs.id,
        JSON.stringify({ hint }),
        config.environment,
        config.region,
      ],
    );
    return { runId: id, shared: false };
  });
}
export async function completeTaxRun(
  run: ClaimedRun,
  data: unknown,
  start: number,
  automaticResult?: object & { logisticsId?: string | null },
) {
  await tx(async (c) => {
    const owned = (
      await c.query(
        "SELECT id FROM analysis_runs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
        [run.id, run.lease_token],
      )
    ).rowCount;
    if (!owned) throw new CatalogError("lease_lost");
    const latest = (
      await c.query(
        "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
        [run.listing_id],
      )
    ).rows[0];
    if (latest?.id !== run.observation_id)
      throw new CatalogError("tax_observation_changed");
    await c.query(
      "INSERT INTO customs_results(id,listing_id,observation_id,run_id,kind,data)VALUES($1,$2,$3,$4,'classification',$5)",
      [
        randomUUID(),
        run.listing_id,
        run.observation_id,
        run.id,
        JSON.stringify(data),
      ],
    );
    if (automaticResult)
      await c.query(
        "INSERT INTO customs_results(id,listing_id,observation_id,run_id,kind,data)VALUES($1,$2,$3,$4,'estimate',$5)",
        [
          randomUUID(),
          run.listing_id,
          run.observation_id,
          run.id,
          JSON.stringify(automaticResult),
        ],
      );
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',finished_at=now(),processing_ms=$2,total_ms=extract(epoch FROM(now()-requested_at))*1000,lease_until=NULL WHERE id=$1",
      [run.id, performance.now() - start],
    );
    if (automaticResult) {
      const current = await latestTaxLogistics(
        c,
        run.listing_id,
        run.observation_id!,
      );
      if ((current?.id || null) !== automaticResult.logisticsId)
        await enqueueAutomaticTax(c, run.listing_id, run.observation_id!);
    }
  });
}
export async function getCustoms(listingId: string) {
  const obs = (
    await pool.query(
      "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
      [listingId],
    )
  ).rows[0];
  const classification =
    (
      await pool.query(
        "SELECT * FROM customs_results WHERE listing_id=$1 AND kind='classification' ORDER BY created_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0] || null;
  const estimate =
    (
      await pool.query(
        "SELECT * FROM customs_results WHERE listing_id=$1 AND kind='estimate' AND COALESCE(data->>'automatic','false')<>'true' ORDER BY created_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0] || null;
  const automatic =
    (
      await pool.query(
        "SELECT * FROM customs_results WHERE listing_id=$1 AND kind='estimate' AND data->>'automatic'='true' ORDER BY created_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0] || null;
  const autoRun =
    (
      await pool.query(
        "SELECT id,status,error_type FROM analysis_runs WHERE listing_id=$1 AND observation_id=$2 AND kind='tax_analysis' ORDER BY requested_at DESC LIMIT 1",
        [listingId, obs?.id || null],
      )
    ).rows[0] || null;
  const logistics = obs
    ? await latestTaxLogistics(pool, listingId, obs.id)
    : null;
  const d = automatic?.data;
  const automaticFresh =
    !!d &&
    automatic.observation_id === obs?.id &&
    d.logisticsId === (logistics?.id || null) &&
    d.version === AUTO_TAX_VERSION &&
    d.taxVersion === TAX_VERSION &&
    d.tariffLookup?.window === tariffWindow() &&
    d.tariffLookup?.referenceDate === koreaDate() &&
    (d.fx?.validFrom === weekStart(koreaDate()) ||
      (!d.fx &&
        Date.now() - new Date(automatic.created_at).getTime() < 600000));
  return {
    classification,
    estimate,
    automatic,
    automaticFresh,
    autoRun,
    observationId: obs?.id || null,
  };
}
export async function readTaxClassification(
  id: string,
  listingId: string,
  observationId: string,
) {
  return (
    await pool.query(
      "SELECT * FROM customs_results WHERE id=$1 AND listing_id=$2 AND observation_id=$3 AND kind='classification'",
      [id, listingId, observationId],
    )
  ).rows[0];
}
export async function saveTaxEstimate(
  runId: string,
  listingId: string,
  observationId: string,
  data: unknown,
  start: number,
) {
  await tx(async (c) => {
    const latest = (
      await c.query(
        "SELECT id FROM observations WHERE listing_id=$1 ORDER BY observed_at DESC LIMIT 1",
        [listingId],
      )
    ).rows[0];
    if (latest?.id !== observationId)
      throw new CatalogError("tax_observation_changed");
    await c.query(
      "INSERT INTO customs_results(id,listing_id,observation_id,run_id,kind,data)VALUES($1,$2,$3,$4,'estimate',$5)",
      [randomUUID(), listingId, observationId, runId, JSON.stringify(data)],
    );
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',finished_at=now(),processing_ms=$2,total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE id=$1",
      [runId, performance.now() - start],
    );
  });
}
