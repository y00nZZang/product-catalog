import { readProductSource } from "./source-reader";
import {
  previousProduct,
  publishCollectionPreview,
  commitCollection,
  failCollection,
} from "../persistence/collection.repository";
import type {
  ClaimedRun,
  PackageResearchResult,
  QuoteComparison,
} from "../domain";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config";

import {
  CatalogError,
  identify,
  errorCode,
  packageSchema,
  emptyProduct,
} from "../domain";

import { safeGet } from "./transport";
import { PARSER_VERSION } from "../merchants/html";

import { extractText } from "../merchants/shared/text";
import { Recorder } from "../jobs/recorder";
import { AiService } from "../ai/service";
import { quotePackage } from "../shipping/calculator";
import { getFx, withConversions } from "../shipping/fx";
export async function collect(
  run: ClaimedRun,
  deps: {
    fetcher?: typeof safeGet;
    fxGetter?: typeof getFx;
    ai?: Pick<AiService, "supplement" | "researchPackage">;
  } = {},
) {
  const fetcher = deps.fetcher || safeGet;
  const fxGetter = deps.fxGetter || getFx;
  const rec = new Recorder(run.id, run.attempt);
  const identity = identify(run.canonical_url);
  const start = performance.now();
  try {
    const source = await readProductSource(identity, rec, {
      fetcher,
      loadPrevious: () => previousProduct(run.listing_id),
    });
    const { html, method, observedAt } = source;
    let product = source.product;
    if (!product && config.llm) product = emptyProduct();
    if (!product) throw new CatalogError("parse_failed");
    const ai = deps.ai || new AiService();
    if (
      config.llm &&
      (!product.title ||
        !product.description ||
        product.price === null ||
        product.currency === null)
    ) {
      try {
        product = await ai.supplement(
          product,
          method === "api"
            ? [product.title, product.description].filter(Boolean).join("\n")
            : extractText(html),
          identity,
          rec,
        );
      } catch (e) {
        product.warnings.push(errorCode(e));
      }
    }
    if (!product.title) throw new CatalogError("parse_missing_title");
    product.warnings = product.warnings.filter(
      (w) =>
        !(w === "description_missing" && product!.description) &&
        !(w === "price_missing" && product!.price !== null) &&
        !(w === "seller_unknown" && product!.seller),
    );
    if (product.price !== null && product.currency) {
      try {
        const fx = await rec.step("fx", "http", "frankfurter", () =>
          fxGetter(product!.currency!),
        );
        product.conversion = {
          amount: Math.round(product.price * fx.rate),
          ...fx,
        };
      } catch {
        product.warnings.push("fx_unavailable");
      }
    }
    await publishCollectionPreview(run, product, observedAt);
    const obsId = randomUUID();
    let specs: PackageResearchResult = {
      package: null,
      reason: "awaiting_package_input",
      sources: [],
    };
    if (config.llm) {
      try {
        specs = await ai.researchPackage(product, identity, rec);
      } catch (e) {
        specs = { package: null, reason: errorCode(e), sources: [] };
      }
    }
    let quote: QuoteComparison | null = null;
    if (specs.package && !specs.requiresReview) {
      const validated = packageSchema.safeParse(specs.package);
      if (validated.success)
        quote = await rec.step("quote", "rate_table", null, async () =>
          withConversions(quotePackage(validated.data, product!)),
        );
      else
        specs = {
          package: null,
          reason: "invalid_package_candidate",
          sources: specs.sources,
        };
    }
    await commitCollection(run, {
      observationId: obsId,
      identity: identity,
      product: product,
      specs,
      quote,
      observedAt,
      contentHash: createHash("sha256").update(html).digest("hex"),
      parserVersion: PARSER_VERSION,
      processingStartedAt: start,
    });
    return { status: "succeeded", method, observationId: obsId };
  } catch (e) {
    return failCollection(run, e, start);
  }
}
