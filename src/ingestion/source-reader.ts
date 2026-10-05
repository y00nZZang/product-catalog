import { config } from "../config";
import {
  CatalogError,
  emptyProduct,
  errorCode,
  type Product,
  type Identity,
} from "../domain";
import { collectRakuten } from "../merchants/rakuten/client";
import { safeGet, browserGet } from "./transport";
import { parseHtml } from "../merchants/html";
import { Recorder } from "../jobs/recorder";

export interface SourceDependencies {
  fetcher: typeof safeGet;
  loadPrevious: () => Promise<Product | undefined>;
}
/** External acquisition and deterministic parsing. Persistence is supplied lazily only when an API lookup needs it. */
export async function readProductSource(
  identity: Identity,
  rec: Recorder,
  dependencies: SourceDependencies,
) {
  const fetcher = dependencies.fetcher;
  let html = "",
    product: Product | undefined;
  let method = "http";
  let observedAt = new Date();
  let sourceHtml: string | undefined;

  let apiWarning: string | null = null;
  if (
    identity.platform === "rakuten" &&
    !identity.options &&
    process.env.RAKUTEN_APPLICATION_ID &&
    process.env.RAKUTEN_ACCESS_KEY
  ) {
    const previous = await dependencies.loadPrevious();
    const result = await collectRakuten(identity, previous, rec, fetcher);
    sourceHtml = result.sourceHtml;
    observedAt = result.observedAt;
    apiWarning = result.warning;
    if (result.product) {
      product = result.product;
      html = result.apiBody || sourceHtml || "";
      method = "api";
    }
  }
  if (!product) {
    if (sourceHtml !== undefined) html = sourceHtml;
    else {
      const response = await rec.step("fetch", "http", identity.platform, () =>
        fetcher(identity.canonicalUrl, undefined, {}, identity),
      );
      html = response.html;
      observedAt = new Date();
    }
    try {
      product = await rec.step("parse", "html", identity.platform, async () =>
        parseHtml(html, identity),
      );
    } catch (e) {
      if (
        !(e instanceof CatalogError) ||
        e.code !== "parse_missing_title" ||
        !(config.browser || config.llm)
      )
        throw e;
    }
    if (
      config.browser &&
      (!product || !product.description || product.price === null)
    ) {
      try {
        const rendered = await rec.step(
          "fetch",
          "browser",
          identity.platform,
          () => browserGet(identity),
        );
        html = rendered.html;
        observedAt = new Date();
        product = await rec.step(
          "parse",
          "rendered_html",
          identity.platform,
          async () => parseHtml(html, identity),
        );
        method = "browser";
      } catch (e) {
        if (
          !product &&
          !(
            config.llm &&
            e instanceof CatalogError &&
            e.code === "parse_missing_title"
          )
        )
          throw e;
        product = product || emptyProduct();
        product.warnings.push(`browser:${errorCode(e)}`);
      }
    }
  }
  if (product && apiWarning) product.warnings.push(apiWarning);
  if (product && !product.sourceType) product.sourceType = method;

  return { html, product: product, method, observedAt };
}
