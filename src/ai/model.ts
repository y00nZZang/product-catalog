import { config } from "../config";
import { CatalogError } from "../domain";

const prices: Record<
  string,
  {
    input: number;
    output: number;
    search: number;
    cached: number;
    write: number;
  }
> = {
  "gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
    search: 0.0132,
    cached: 0.1,
    write: 0.4,
  },
  "gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    search: 0.01,
    cached: 0.01,
    write: 0.125,
  },
};
export function modelOptions() {
  return {
    model: config.model,
    ...(config.model === "gpt-6-luna"
      ? { reasoning: { effort: "none" as const } }
      : {}),
  };
}
export function modelPricing(model: string) {
  const price = prices[model];
  if (!price) throw new CatalogError("model_budget_not_configured");
  return price;
}
export function estimateModelCost(
  model: string,
  input: number,
  output: number,
  searches: number,
  details?: { cached_tokens?: number; cache_write_tokens?: number },
) {
  const p = modelPricing(model);
  const cached = Math.min(input, Math.max(0, details?.cached_tokens || 0));
  const writes = Math.min(
    input - cached,
    Math.max(0, details?.cache_write_tokens || 0),
  );
  return {
    amount:
      ((input - cached - writes) * p.input +
        cached * p.cached +
        writes * p.write +
        output * p.output) /
        1e6 +
      searches * p.search,
    basis: `estimated: ${model} input ${p.input}/output ${p.output} USD per million; search ${p.search} USD per call; cache read ${p.cached}/write ${p.write} USD per million; search-context adjustments may differ; verify billing; checked 2026-10-05`,
  };
}
