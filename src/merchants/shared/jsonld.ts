import type { CheerioAPI } from "cheerio";
import { identify, type Identity, type Product } from "../../domain";
import { clean, amount, objects } from "./text";
import type { FieldEvidenceRecorder } from "./types";

export function applyJsonLd(
  $: CheerioAPI,
  p: Product,
  id: Identity,
  evidence: FieldEvidenceRecorder,
) {
  const docs: any[] = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      docs.push(...objects(JSON.parse($(e).text())));
    } catch {
      p.warnings.push("invalid_json_ld");
    }
  });
  const products = docs.filter((x) =>
    ([].concat(x["@type"] || []) as string[]).includes("Product"),
  );
  const primary =
    products.find((x) => {
      try {
        return (
          identify(new URL(x.url || x["@id"], id.canonicalUrl).href).key ===
          id.key
        );
      } catch {
        return false;
      }
    }) ||
    (products.length === 1 && !products[0].url && !products[0]["@id"]
      ? products[0]
      : null);
  if (primary) {
    p.title = clean(primary.name);
    p.description = clean(primary.description);
    p.category = clean(primary.category);
    p.seller = clean(primary.seller?.name);
    p.condition = clean(primary.itemCondition);
    p.identifiers = ["gtin", "gtin13", "gtin12", "isbn", "mpn"]
      .map((k) => clean(primary[k]))
      .filter(Boolean) as string[];
    p.images = []
      .concat(primary.image || [])
      .map((v: any) => (typeof v === "string" ? v : v.url))
      .filter((s: any) => typeof s === "string" && s.startsWith("https://"));
    const offers = [].concat(primary.offers || []).filter(Boolean) as any[];
    if (offers.length === 1 && offers[0]["@type"] !== "AggregateOffer") {
      const o = offers[0];
      p.price = amount(o.price);
      p.currency = clean(o.priceCurrency);
      p.seller = clean(o.seller?.name) || p.seller;
      p.condition = p.condition || clean(o.itemCondition);
      p.availability = /\/(InStock|LimitedAvailability)$/.test(
        o.availability || "",
      )
        ? "in_stock"
        : /\/(SoldOut|OutOfStock|Discontinued)$/.test(o.availability || "")
          ? "sold_out"
          : "unknown";
      const shipping = [].concat(o.shippingDetails || []) as any[];
      if (shipping.length === 1) {
        const s = shipping[0];
        p.domesticShipping = {
          amount: amount(s.shippingRate?.value),
          currency: clean(s.shippingRate?.currency),
          condition: JSON.stringify(s.shippingDestination || {}),
          payer: null,
        };
      }
    } else if (offers.length) p.warnings.push("multiple_or_aggregate_offers");
    for (const k of [
      "title",
      "description",
      "price",
      "currency",
      "availability",
      "condition",
      "identifiers",
      "seller",
      "category",
      "domesticShipping",
    ])
      evidence(k, "json_ld");
  }
}
