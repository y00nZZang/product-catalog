import { modelOptions } from "./model";
/** Legacy text-only baseline for regression/comparison; production uses package-estimate.ts. */
import { validatePackageProposal } from "./package-validation";
import {
  PROPOSAL_PROMPT_1,
  PROPOSAL_PROMPT_2,
  PROPOSAL_PROMPT_3,
} from "./prompts";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CatalogError, type Product, type Identity } from "../domain";
import { Recorder } from "../jobs/recorder";
import type { ModelCaller } from "./executor";

import { manualPackageSpec } from "./schemas";

export async function suggestPackage(
  caller: ModelCaller,
  p: Product,
  id: Identity,
  rec: Recorder,
  hint = "",
) {
  if (!p.title) throw new CatalogError("package_source_insufficient");
  const identifiers = p.identifiers.filter((x) =>
    /^[A-Za-z0-9-]{6,30}$/.test(x),
  );
  let report = "";
  let urls: string[] = [id.canonicalUrl];
  if (!hint.trim()) {
    // Same material and prompt as automatic identifier search: reuse its durable result.
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
          instructions: identifiers.length
            ? PROPOSAL_PROMPT_1
            : PROPOSAL_PROMPT_2,
          input: JSON.stringify({ title: p.title, identifiers }),
        } as OpenAI.Responses.ResponseCreateParamsNonStreaming & {
          max_tool_calls: number;
        }),
      { title: p.title, identifiers },
    );
    report = search.output_text || "";
    let cited = false;
    for (const out of search.output || []) {
      for (const s of out.action?.sources || [])
        if (s.url?.startsWith("https://")) {
          urls.push(s.url);
          cited = true;
        }
      for (const c of out.content || [])
        for (const a of c.annotations || [])
          if (a.type === "url_citation" && a.url?.startsWith("https://")) {
            urls.push(a.url);
            cited = true;
          }
    }
    urls = [...new Set(urls)];
    if (!cited) report = "";
  }
  const material = {
    proposalContract: "grounded-v2",
    title: p.title,
    description: p.description?.slice(0, 12000) || "",
    identifiers,
    options: p.options,
    quantity: p.quantity,
    hint,
    report: report.slice(0, 10000),
    sources: urls,
  };
  const response = await caller.call(
    rec,
    "package_estimate",
    (c) =>
      c.responses.parse({
        ...modelOptions(),
        store: false,
        max_output_tokens: 1800,
        instructions: PROPOSAL_PROMPT_3,
        input: JSON.stringify(material),
        text: {
          format: zodTextFormat(manualPackageSpec, "package_suggestion"),
        },
      }),
    material,
  );
  return validatePackageProposal(
    response.output_parsed,
    material,
    hint,
    urls,
    id,
  );
}
