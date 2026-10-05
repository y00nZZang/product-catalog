import { modelOptions } from "./model";
import { EXTRACTION_PROMPT_1 } from "./prompts";

import { zodTextFormat } from "openai/helpers/zod";
import { type Product, type Identity } from "../domain";
import { Recorder } from "../jobs/recorder";
import type { ModelCaller } from "./executor";

import { extracted } from "./schemas";

export async function supplement(
  caller: ModelCaller,
  product: Product,
  text: string,
  id: Identity,
  rec: Recorder,
): Promise<Product> {
  const response = await caller.call(
    rec,
    "llm_extract",
    (c) =>
      c.responses.parse({
        ...modelOptions(),
        store: false,
        max_output_tokens: 1600,
        instructions: EXTRACTION_PROMPT_1,
        input: JSON.stringify({
          url: id.canonicalUrl,
          title: product.title,
          text: text.slice(0, 18000),
        }),
        text: { format: zodTextFormat(extracted, "product_fields") },
      }),
    {
      url: id.canonicalUrl,
      title: product.title,
      text: text.slice(0, 18000),
    },
  );
  const data = extracted.parse(response.output_parsed);
  const p = structuredClone(product);
  for (const k of [
    "title",
    "description",
    "seller",
    "price",
    "currency",
    "condition",
  ] as const) {
    const f = data[k];
    if (p[k] !== null || !f.value || !f.evidence || !text.includes(f.evidence))
      continue;
    if (k === "price") {
      const n = Number(f.value);
      if (
        !Number.isFinite(n) ||
        n < 0 ||
        !f.evidence.replace(/,/g, "").includes(f.value) ||
        id.options
      )
        continue;
      p.price = n;
    } else if (k === "currency") {
      if (!/^[A-Z]{3}$/.test(f.value) || !f.evidence.includes(f.value))
        continue;
      p.currency = f.value;
    } else {
      if (!f.evidence.includes(f.value)) continue;
      p[k] = f.value;
    }
    p.evidence[k] = {
      source: id.canonicalUrl,
      method: "llm_verified_excerpt",
      excerpt: f.evidence.slice(0, 240),
    };
  }
  // Shipping terms and availability remain parser-derived; an isolated number is insufficient evidence.
  p.translatedTitle = data.translatedTitle;
  p.warnings = [...new Set([...p.warnings, "llm_supplement_used"])];
  return p;
}
