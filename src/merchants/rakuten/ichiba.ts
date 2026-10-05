import { load } from "cheerio";
import {
  CatalogError,
  identify,
  emptyProduct,
  type Identity,
  type Product,
} from "../../domain";
import { clean, amount } from "../shared/text";

export function resolveRakutenItemCode(
  html: string,
  id: Identity,
): string | null {
  const [shop, manageNumber] = id.externalId.split(":");
  const $ = load(html);
  const formCodes = new Set<string>();
  $('input[name="item_number"]').each((_, el) => {
    if ($(el).attr("value") !== manageNumber) return;
    const form = $(el).closest("form");
    const scope = form.length ? form : $.root();
    const shopCodes = [
      ...new Set(
        scope
          .find('input[name="shopurl"]')
          .map((_, e) => $(e).attr("value"))
          .get(),
      ),
    ];
    const itemIds = [
      ...new Set(
        scope
          .find('input[name="item_id"]')
          .map((_, e) => $(e).attr("value"))
          .get(),
      ),
    ];
    if (
      shopCodes.length === 1 &&
      shopCodes[0] === shop &&
      itemIds.length === 1 &&
      /^\d+$/.test(itemIds[0])
    )
      formCodes.add(shop + ":" + itemIds[0]);
  });
  if (formCodes.size === 1) return [...formCodes][0];
  const candidates = [
    ...new Set(html.match(/[A-Za-z0-9_-]+:\d+/g) || []),
  ].filter((code) => code.startsWith(shop + ":"));
  // Ambiguous pages can contain recommendation IDs; never guess among them.
  return candidates.length === 1 ? candidates[0] : null;
}

export function parseRakutenApi(
  payload: any,
  id: Identity,
  apiItemCode = id.externalId,
): Product {
  const items = payload.Items || payload.items || [];
  const item = items
    .map((x: any) => x.Item || x.item || x)
    .find((x: any) => x.itemCode === apiItemCode);
  if (!item) throw new CatalogError("api_item_not_found");
  let responseIdentity: Identity;
  try {
    responseIdentity = identify(item.itemUrl);
  } catch {
    throw new CatalogError("api_identity_mismatch");
  }
  if (
    responseIdentity.platform !== id.platform ||
    responseIdentity.externalId !== id.externalId
  )
    throw new CatalogError("api_identity_mismatch");
  const p = emptyProduct();
  p.apiItemCode = apiItemCode;
  p.sourceType = "rakuten_ichiba_api";
  p.title = clean(item.itemName);
  p.description = clean(item.itemCaption);
  p.price = amount(item.itemPrice);
  p.currency = "JPY";
  const low = amount(item.itemPriceMin1),
    high = amount(item.itemPriceMax1);
  if (low !== null && high !== null && high > low) {
    p.priceRange = { min: low, max: high, currency: "JPY" };
    p.price = null;
    p.warnings.push("option_price_requires_verification");
  }
  p.seller = clean(item.shopName);
  p.category = String(item.genreId || "") || null;
  p.availability =
    item.availability === 1
      ? "in_stock"
      : item.availability === 0
        ? "sold_out"
        : "unknown";
  p.images = (item.mediumImageUrls || [])
    .map((x: any) => x.imageUrl)
    .filter((x: any) => typeof x === "string" && x.startsWith("https://"));
  if (item.postageFlag === 0)
    p.domesticShipping = {
      amount: 0,
      currency: "JPY",
      condition: "API postageFlag=0; destination conditions may apply",
      payer: "seller",
    };
  for (const k of [
    "title",
    "description",
    "price",
    "currency",
    "seller",
    "availability",
    "domesticShipping",
  ])
    p.evidence[k] = { source: id.canonicalUrl, method: "rakuten_api" };
  if (!p.title) throw new CatalogError("parse_missing_title");
  return p;
}
