import { load } from "cheerio";
import {
  CatalogError,
  emptyProduct,
  type Product,
  type Identity,
} from "../domain";
import { clean } from "./shared/text";
import { applyJsonLd } from "./shared/jsonld";
import { applyRakutenHtml } from "./rakuten/html";
import { applyMercariHtml } from "./mercari/html";

export const PARSER_VERSION = "2026-09-22.2";

/** Parse only the requested listing, then annotate missing/ambiguous fields instead of guessing. */

export function parseHtml(html: string, id: Identity): Product {
  const $ = load(html);
  const p = emptyProduct();
  const meta = (k: string) =>
    $(`meta[property="${k}"],meta[name="${k}"]`).first().attr("content");
  const evidence = (field: string, method: string, excerpt?: string) => {
    p.evidence[field] = {
      source: id.canonicalUrl,
      method,
      excerpt: excerpt?.slice(0, 240),
    };
  };
  applyJsonLd($, p, id, evidence);
  p.title =
    p.title ||
    clean(meta("og:title"))?.replace(/ by メルカリ$/, "") ||
    clean($('h1[itemprop="name"],h1').first().text());
  if (p.title && !p.evidence.title) evidence("title", "html");
  if (!p.images.length && meta("og:image")?.startsWith("https://"))
    p.images = [meta("og:image")!];
  if (id.platform === "rakuten") applyRakutenHtml($, p, id, evidence, meta);
  else applyMercariHtml($, p, evidence, meta);
  if (
    $("button")
      .toArray()
      .some((e) => $(e).text().trim() === "入札する")
  ) {
    p.price = null;
    delete p.evidence.price;
    p.warnings.push("auction_price_requires_review");
  }
  if (!p.seller) p.warnings.push("seller_unknown");
  if (!p.description) p.warnings.push("description_missing");
  if (p.availability === "unknown") p.warnings.push("availability_unknown");
  if (p.price === null) p.warnings.push("price_missing");
  if (p.domesticShipping.amount === null)
    p.warnings.push("domestic_shipping_unknown");
  if (id.options) {
    p.options = id.options;
    p.price = null;
    p.warnings.push("option_price_requires_verification");
    delete p.evidence.price;
  }
  if (!p.title) throw new CatalogError("parse_missing_title");
  if (p.currency && !/^[A-Z]{3}$/.test(p.currency)) {
    p.currency = null;
    p.warnings.push("invalid_currency");
  }
  return p;
}
