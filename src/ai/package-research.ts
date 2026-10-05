import { modelOptions } from "./model";
/** Legacy text-only baseline for regression/comparison; production uses package-estimate.ts. */
import { PROPOSAL_PROMPT_1, RESEARCH_PROMPT_1 } from "./prompts";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { type Product, type Identity, type PackageInput } from "../domain";
import { Recorder } from "../jobs/recorder";
import type { ModelCaller } from "./executor";

import { spec } from "./schemas";

export async function researchPackage(
  caller: ModelCaller,
  p: Product,
  id: Identity,
  rec: Recorder,
): Promise<{
  package: PackageInput | null;
  productWeightGrams: number | null;
  sources: string[];
  reason: string;
}> {
  const identifiers = p.identifiers.filter((x) =>
    /^[A-Za-z0-9-]{6,30}$/.test(x),
  );
  if (!identifiers.length)
    return {
      package: null,
      productWeightGrams: null,
      sources: [],
      reason: "exact_identifier_required",
    };
  const search = await caller.call(
    rec,
    "web_search",
    (c) =>
      c.responses.create({
        ...modelOptions(),
        store: false,
        max_output_tokens: 1800,
        max_tool_calls: 1,
        tools: [{ type: "web_search", search_context_size: "low" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        instructions: PROPOSAL_PROMPT_1,
        input: JSON.stringify({ title: p.title, identifiers }),
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming & {
        max_tool_calls: number;
      }),
    { title: p.title, identifiers },
  );
  const sources: string[] = [];
  for (const output of search.output || []) {
    for (const s of output.action?.sources || [])
      if (s.url) sources.push(s.url);
    for (const c of output.content || [])
      for (const a of c.annotations || [])
        if (a.type === "url_citation" && a.url) sources.push(a.url);
  }
  const unique = [...new Set(sources.filter((s) => s.startsWith("https://")))];
  if (!unique.length)
    return {
      package: null,
      productWeightGrams: null,
      sources: [],
      reason: "no_cited_source",
    };
  const normalized = await caller.call(
    rec,
    "spec_estimate",
    (c) =>
      c.responses.parse({
        ...modelOptions(),
        store: false,
        max_output_tokens: 1200,
        instructions: RESEARCH_PROMPT_1,
        input: JSON.stringify({
          identifiers,
          report: search.output_text.slice(0, 10000),
          sources: unique,
        }),
        text: { format: zodTextFormat(spec, "package_spec") },
      }),
    {
      identifiers,
      report: search.output_text.slice(0, 10000),
      sources: unique,
    },
  );
  const d = spec.parse(normalized.output_parsed);
  const validSources = d.sources.filter((s) => unique.includes(s));
  if (
    !d.matchedIdentifier ||
    !identifiers.includes(d.matchedIdentifier) ||
    !validSources.length ||
    d.basis === "unknown" ||
    ![d.packageWeightGrams, d.lengthCm, d.widthCm, d.heightCm].every(
      (n) => typeof n === "number" && n > 0,
    )
  )
    return {
      package: null,
      productWeightGrams: d.productWeightGrams,
      sources: validSources,
      reason: "package_not_established",
    };
  // Search output remains a candidate, never promoted to measured/verified without source review.
  return {
    package: {
      weightGrams: d.packageWeightGrams!,
      lengthCm: d.lengthCm!,
      widthCm: d.widthCm!,
      heightCm: d.heightCm!,
      basis: "estimated",
      source: validSources.join("\n"),
      assumptions: [
        "검색 결과 기반 추정; 원문 사양 및 포장 조건 확인 필요",
        ...d.assumptions,
      ],
    },
    productWeightGrams: d.productWeightGrams,
    sources: validSources,
    reason: "source_backed_candidate",
  };
}
