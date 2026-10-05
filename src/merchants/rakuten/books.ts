import { load } from "cheerio";
import {
  CatalogError,
  identify,
  emptyProduct,
  type Identity,
  type Product,
} from "../../domain";
import { clean } from "../shared/text";

export function resolveBooksCode(html: string): string | null {
  const $ = load(html);
  const candidates = new Set<string>();
  $("#productDetailedDescription li").each((_, e) => {
    const t = $(e).text().replace(/\s+/g, " ");
    const m = t.match(/(?:JAN|ISBN(?:コード)?)[：:\s]+([\d-]{13,17})/i);
    if (m) {
      const code = m[1].replace(/-/g, "");
      if (/^\d{13}$/.test(code)) candidates.add(code);
    }
  });
  const cd = $("#ratProductCd").attr("value");
  if (cd && /^\d{13}$/.test(cd)) candidates.add(cd);
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function parseBooksApi(
  payload: any,
  id: Identity,
  code: string | null,
): Product {
  const all = (payload.Items || payload.items || []).map(
    (v: any) => v.Item || v.item || v,
  );
  const matches = all.filter((item: any) => {
    try {
      return (
        identify(item.itemUrl).externalId === id.externalId &&
        identify(item.itemUrl).platform === id.platform
      );
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new CatalogError("api_item_not_found");
  const item = matches[0];
  if (code && ![String(item.jan || ""), String(item.isbn || "")].includes(code))
    throw new CatalogError("api_identity_mismatch");
  const p = emptyProduct();
  p.sourceType = "rakuten_books_api";
  p.apiBooksCode = code || String(item.jan || item.isbn || "") || undefined;
  p.title = clean(item.title);
  p.description = clean(item.itemCaption);
  p.seller = "楽天ブックス";
  p.category = clean(item.booksGenreId);
  p.identifiers = [item.jan, item.isbn].filter(
    (s: any) => typeof s === "string" && s.length > 0,
  );
  const price = Number(item.itemPrice);
  p.price =
    item.itemPrice != null && Number.isFinite(price) && price >= 0
      ? price
      : null;
  p.currency = "JPY";
  const state = String(item.availability);
  p.availability =
    state === "1"
      ? "in_stock"
      : state === "5"
        ? "preorder"
        : ["2", "3", "4"].includes(state)
          ? "backorder"
          : "unknown";
  if (state === "2") p.dispatchDays = { min: 3, max: 7 };
  if (state === "3") p.dispatchDays = { min: 3, max: 9 };
  // Books: 1 means free; Ichiba: 0 means included. They are deliberately separate.
  if ([1, 2].includes(Number(item.postageFlag)))
    p.domesticShipping = {
      amount: 0,
      currency: "JPY",
      condition:
        Number(item.postageFlag) === 1
          ? "楽天ブックス API: 送料無料"
          : "楽天ブックス API: 送料込 (상품가에 포함)",
      payer: "seller",
    };
  else
    p.domesticShipping.condition =
      "Books API postageFlag=" +
      String(item.postageFlag ?? "unknown") +
      "; amount unknown";
  p.images = [
    item.largeImageUrl || item.mediumImageUrl || item.smallImageUrl,
  ].filter((x) => typeof x === "string" && x.startsWith("https://"));
  for (const field of [
    "title",
    "description",
    "price",
    "currency",
    "seller",
    "category",
    "availability",
    "identifiers",
    "domesticShipping",
  ])
    p.evidence[field] = {
      source: id.canonicalUrl,
      method: "rakuten_books_api",
    };
  if (!p.title) throw new CatalogError("parse_missing_title");
  return p;
}
