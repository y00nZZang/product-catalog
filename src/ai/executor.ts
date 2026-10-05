import { modelPricing, estimateModelCost } from "./model";
import type { ModelResponse } from "./types";
import {
  recordAiCacheHit,
  recordAiReservation,
  recordAiUsage,
} from "../persistence/ai.repository";
import OpenAI from "openai";
import { config } from "../config";

import { CatalogError } from "../domain";
import { Recorder } from "../jobs/recorder";
import {
  aiRequestKey,
  claimAiRequest,
  completeAiRequest,
  failAiRequest,
  reserveDailyBudget,
} from "../persistence/ai.repository";

async function reserve() {
  if (!config.llm || !process.env.OPENAI_API_KEY)
    throw new CatalogError("llm_disabled");
  modelPricing(config.model);
  return reserveDailyBudget(
    config.dailyBudget,
    config.callReserve,
    config.budgetUnlimited,
  );
}

/** All paid requests pass here: reserve once, disable SDK retries, and record cache hits separately. */
export class OpenAiExecutor {
  private client() {
    return new OpenAI({
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      timeout: 45000,
    });
  }
  async call(
    rec: Recorder,
    stage: string,
    fn: (client: OpenAI) => Promise<ModelResponse>,
    material: unknown,
  ): Promise<ModelResponse> {
    return rec.step(stage, "openai_responses", "openai", async (stepId) => {
      const key = aiRequestKey(stage, config.model, material);
      const claim = await claimAiRequest(key, stage, config.model);
      if (claim.cached) {
        await recordAiCacheHit(stepId, key, config.model);
        return claim.result;
      }
      let response: ModelResponse;
      let dispatched = false;
      try {
        await reserve();
        await recordAiReservation(
          stepId,
          key,
          config.model,
          config.callReserve,
        );
        dispatched = true;
        response = await fn(this.client());
        if (response.status !== "completed")
          throw new CatalogError("llm_incomplete");
        await completeAiRequest(key, claim.ownerId, response);
      } catch (e) {
        const status = (e as { status?: number } | null)?.status;
        const code =
          e instanceof CatalogError
            ? e.code
            : typeof status === "number" &&
                [400, 401, 403, 404, 429, 500, 502, 503].includes(status)
              ? `llm_http_${status}`
              : "llm_request_failed";
        await failAiRequest(key, claim.ownerId, code, dispatched);
        throw new CatalogError(code);
      }
      const usage = response.usage || {};
      const searches = (response.output || []).filter(
        (o: any) => o.type === "web_search_call",
      ).length;
      // Record tokens and a labeled estimate; the reservation remains charged on failures as well.
      const estimate = estimateModelCost(
        config.model,
        usage.input_tokens || 0,
        usage.output_tokens || 0,
        searches,
        usage.input_tokens_details,
      );
      await recordAiUsage(
        stepId,
        usage,
        searches,
        estimate.amount,
        estimate.basis,
      );
      if (response.status !== "completed")
        throw new CatalogError("llm_incomplete");
      return response;
    });
  }
}

export type ModelCaller = Pick<OpenAiExecutor, "call">;
