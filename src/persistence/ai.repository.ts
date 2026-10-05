import type { ModelResponse } from "../ai/types";
import { createHash, randomUUID } from "node:crypto";
import { tx, pool } from "./connection";
import { CatalogError } from "../domain";
export const AI_PROMPT_VERSION = "2026-09-22.2";
export function aiRequestKey(stage: string, model: string, material: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify({ version: AI_PROMPT_VERSION, stage, model, material }),
    )
    .digest("hex");
}
export async function claimAiRequest(
  key: string,
  stage: string,
  model: string,
) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
      key,
    ]);
    const row = (
      await c.query(
        "SELECT *,expires_at>now() AS fresh FROM ai_requests WHERE cache_key=$1",
        [key],
      )
    ).rows[0];
    if (row?.status === "succeeded" && row.fresh)
      return {
        cached: true as const,
        result: row.result,
        ownerId: row.owner_id,
      };
    if (row?.status === "pending")
      throw new CatalogError("ai_request_pending_or_unknown");
    if (row?.status === "failed")
      throw new CatalogError("ai_previous_request_failed");
    const ownerId = randomUUID();
    await c.query(
      `INSERT INTO ai_requests(cache_key,stage,model,owner_id,status) VALUES($1,$2,$3,$4,'pending')
   ON CONFLICT(cache_key) DO UPDATE SET owner_id=EXCLUDED.owner_id,status='pending',created_at=now(),finished_at=NULL,expires_at=NULL,result=NULL,error_type=NULL`,
      [key, stage, model, ownerId],
    );
    return { cached: false as const, ownerId };
  });
}
export async function completeAiRequest(
  key: string,
  ownerId: string,
  response: ModelResponse,
) {
  const result = {
    status: response.status,
    output: response.output,
    output_text: response.output_text,
    output_parsed: response.output_parsed,
    usage: response.usage,
  };
  await pool.query(
    "UPDATE ai_requests SET status='succeeded',finished_at=now(),expires_at=now()+interval '7 days',result=$3 WHERE cache_key=$1 AND owner_id=$2 AND status='pending'",
    [key, ownerId, JSON.stringify(result)],
  );
}
export async function failAiRequest(
  key: string,
  ownerId: string,
  code: string,
  dispatched: boolean,
) {
  await pool.query(
    "UPDATE ai_requests SET status=$3,error_type=$4,finished_at=now() WHERE cache_key=$1 AND owner_id=$2 AND status='pending'",
    [key, ownerId, dispatched ? "failed" : "not_sent", code],
  );
}

export async function reserveDailyBudget(
  limit: number,
  reservation: number,
  unlimited = false,
) {
  if (
    (!unlimited && (!Number.isFinite(limit) || limit <= 0)) ||
    !Number.isFinite(reservation) ||
    reservation < 0.1
  )
    throw new CatalogError("ai_budget_required");
  // Explicit unlimited mode removes only the cap; retain usage accounting and request deduplication.
  if (unlimited) {
    await pool.query(
      `INSERT INTO ai_budget(day,reserved_usd,calls) VALUES(CURRENT_DATE,$1,1)
       ON CONFLICT(day) DO UPDATE SET reserved_usd=ai_budget.reserved_usd+EXCLUDED.reserved_usd,calls=ai_budget.calls+1`,
      [reservation],
    );
    return;
  }
  const result = await pool.query(
    `INSERT INTO ai_budget(day,reserved_usd,calls) SELECT CURRENT_DATE,$1::numeric,1 WHERE $1::numeric<=$2::numeric
   ON CONFLICT(day) DO UPDATE SET reserved_usd=ai_budget.reserved_usd+EXCLUDED.reserved_usd,calls=ai_budget.calls+1
   WHERE ai_budget.reserved_usd+EXCLUDED.reserved_usd<=$2::numeric RETURNING day`,
    [reservation, limit],
  );
  if (!result.rowCount) throw new CatalogError("ai_budget_exhausted");
}

export async function recordAiCacheHit(
  stepId: string,
  key: string,
  model: string,
) {
  await pool.query(
    "UPDATE analysis_steps SET input_tokens=0,output_tokens=0,search_calls=0,cost_usd=0,cost_basis='cached; no provider call',metadata=$2 WHERE id=$1",
    [
      stepId,
      JSON.stringify({
        cacheHit: true,
        requestKey: key,
        model: model,
      }),
    ],
  );
}

export async function recordAiReservation(
  stepId: string,
  key: string,
  model: string,
  reservation: number,
) {
  await pool.query(
    "UPDATE analysis_steps SET metadata=$2,cost_basis='reservation; actual provider bill not verified' WHERE id=$1",
    [
      stepId,
      JSON.stringify({
        reserved_usd: reservation,
        model: model,
        requestKey: key,
        cacheHit: false,
      }),
    ],
  );
}

export async function recordAiUsage(
  stepId: string,
  usage: { input_tokens?: number; output_tokens?: number },
  searches: number,
  estimate: number,
  costBasis: string,
) {
  await pool.query(
    "UPDATE analysis_steps SET input_tokens=$2,output_tokens=$3,search_calls=$4,cost_usd=$5,cost_basis=$6 WHERE id=$1",
    [
      stepId,
      usage.input_tokens ?? null,
      usage.output_tokens ?? null,
      searches,
      estimate,
      costBasis,
    ],
  );
}
