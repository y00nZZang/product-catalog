import { enqueueAutomaticTax } from "./customs-auto.repository";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./connection";
import { config } from "../config";
import type { PackageInput, QuoteComparison } from "../domain";
export async function createQuoteRun(id: string, observationId: string) {
  const runId = randomUUID();
  await pool.query(
    "INSERT INTO analysis_runs(id,kind,listing_id,observation_id,status,started_at,queue_ms,environment,region) VALUES($1,'quote',$2,$3,'running',now(),0,$4,$5)",
    [runId, id, observationId, config.environment, config.region],
  );
  await pool.query(
    "UPDATE analysis_runs SET lease_until=now()+interval '180 seconds',attempt=1 WHERE id=$1",
    [runId],
  );

  return runId;
}
export async function commitQuote(
  runId: string,
  id: string,
  observationId: string,
  pkg: PackageInput,
  data: QuoteComparison,
  started: number,
) {
  await tx(async (c) => {
    await c.query(
      "INSERT INTO logistics(id,listing_id,observation_id,run_id,data) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        id,
        observationId,
        runId,
        JSON.stringify({ package: pkg, reason: "user_input" }),
      ],
    );
    await c.query(
      "INSERT INTO quotes(id,listing_id,observation_id,run_id,data) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), id, observationId, runId, JSON.stringify(data)],
    );
    await enqueueAutomaticTax(c, id, observationId);
    await c.query(
      "UPDATE analysis_runs SET status='succeeded',finished_at=now(),processing_ms=$2,total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE id=$1",
      [runId, performance.now() - started],
    );
  });
}
export async function failQuote(runId: string, code: string, started: number) {
  await pool.query(
    "UPDATE analysis_runs SET status='failed',error_type=$2,finished_at=now(),processing_ms=$3,total_ms=extract(epoch FROM(now()-requested_at))*1000 WHERE id=$1",
    [runId, code, performance.now() - started],
  );
}
