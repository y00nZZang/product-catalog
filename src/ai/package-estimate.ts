import { modelOptions } from "./model";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CatalogError, type Product, type Identity } from "../domain";
import type { Recorder } from "../jobs/recorder";
import type { ModelCaller } from "./executor";
import { preparePackageImages } from "./package-images";
import { estimateSchema, visualSchema } from "./package-estimate-schema";
import {
  validateEstimate,
  type EstimateSource,
} from "./package-estimate-validation";
import {
  PACKAGE_CONTRACT,
  VISUAL_PROMPT,
  SEARCH_PROMPT,
  ESTIMATE_PROMPT,
  ESTIMATE_CONTRACT,
  DERIVATION_PROMPT,
} from "./package-estimate-prompts";
import { quotePackage } from "../shipping/calculator";

export async function estimatePackage(
  caller: ModelCaller,
  product: Product,
  id: Identity,
  rec: Recorder,
  hint = "",
  prepare = preparePackageImages,
) {
  if (!product.title) throw new CatalogError("package_source_insufficient");
  const prepared = await rec.step("package_images", "http", null, () =>
    prepare(product.images),
  );
  const listing = {
    title: product.title,
    description: product.description?.slice(0, 12000) || "",
    identifiers: product.identifiers,
    quantity: product.quantity,
    options: product.options,
    hint,
  };
  // Persist/cache only image hashes + public URLs. Never persist binary images in ai_requests or logs.
  const visualMaterial = {
    contract: PACKAGE_CONTRACT,
    listing,
    images: prepared.images.map(({ url, hash }) => ({ url, hash })),
  };
  const seen = await caller.call(
    rec,
    "package_visual",
    (c) =>
      c.responses.parse({
        ...modelOptions(),
        store: false,
        max_output_tokens: 1400,
        instructions: VISUAL_PROMPT,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: JSON.stringify(listing) },
              ...prepared.images.map((i) => ({
                type: "input_image" as const,
                image_url: i.dataUrl,
                detail: "auto" as const,
              })),
            ],
          },
        ],
        text: { format: zodTextFormat(visualSchema, "package_identity") },
      }),
    visualMaterial,
  );
  const visual = visualSchema.parse(seen.output_parsed);
  const searchQuery = (visual.searchQuery || product.title)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
  const searchMaterial = {
    contract: PACKAGE_CONTRACT,
    searchContract: "focused-query-v2",
    query: searchQuery,
  };
  const searched = await caller.call(
    rec,
    "package_search",
    (c) =>
      c.responses.create({
        ...modelOptions(),
        store: false,
        max_output_tokens: 2200,
        max_tool_calls: 2,
        instructions: SEARCH_PROMPT,
        input: searchQuery,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming & {
        max_tool_calls: number;
      }),
    searchMaterial,
  );
  const urls: string[] = [];
  for (const output of searched.output || []) {
    for (const source of output.action?.sources || [])
      if (source.url) urls.push(source.url);
    for (const content of output.content || [])
      for (const a of content.annotations || [])
        if (a.type === "url_citation" && a.url) urls.push(a.url);
  }
  const cited = [...new Set(urls)]
    .filter((raw) => {
      try {
        const u = new URL(raw);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    })
    .slice(0, 8);
  const sources: EstimateSource[] = [
    { id: "listing", url: id.canonicalUrl, kind: "listing" },
    ...cited.map((url, i) => ({
      id: `search_${i + 1}`,
      url,
      kind: "search" as const,
    })),
  ];
  const material = {
    contract: PACKAGE_CONTRACT,
    estimateContract: ESTIMATE_CONTRACT,
    listing,
    visual,
    sources,
    report: cited.length ? searched.output_text.slice(0, 14000) : "",
    hasImages: prepared.images.length > 0,
  };
  const response = await caller.call(
    rec,
    "package_estimate_v3",
    (c) =>
      c.responses.parse({
        ...modelOptions(),
        store: false,
        max_output_tokens: 4000,
        instructions: ESTIMATE_PROMPT + "\n" + DERIVATION_PROMPT,
        input: JSON.stringify(material),
        text: { format: zodTextFormat(estimateSchema, "package_ranges") },
      }),
    material,
  );
  const result = validateEstimate(
    response.output_parsed,
    sources,
    prepared.images.length > 0,
    hint,
  );
  const quoteScenarios = result.package
    ? ["low", "typical", "high"].map((scenario) => {
        const pkg = { ...result.package! };
        for (const key of [
          "weightGrams",
          "lengthCm",
          "widthCm",
          "heightCm",
        ] as const)
          pkg[key] =
            result.ranges[key]![scenario as "low" | "typical" | "high"];
        return { scenario, ...quotePackage(pkg, product) };
      })
    : [];
  return {
    ...result,
    contract: PACKAGE_CONTRACT,
    visual,
    imageCount: prepared.images.length,
    imageWarnings: prepared.warnings,
    searchWarnings: cited.length ? [] : ["no_cited_source"],
    quoteScenarios,
  };
}
