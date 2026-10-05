import type { CheerioAPI } from "cheerio";
import type { Product, Identity } from "../../domain";
import type { FieldEvidenceRecorder } from "../shared/types";
import { clean, amount } from "../shared/text";

export function applyRakutenHtml(
  $: CheerioAPI,
  p: Product,
  id: Identity,
  evidence: FieldEvidenceRecorder,
  meta: (key: string) => string | undefined,
) {
  const price = $('[itemprop="price"]').first();
  if (p.price === null && price.length) {
    p.price = amount(price.attr("content") || price.text());
    evidence("price", "microdata", price.attr("content") || price.text());
  }
  p.currency =
    p.currency ||
    clean($('[itemprop="priceCurrency"]').first().attr("content"));
  if (id.externalId.startsWith("books:")) {
    p.seller = "楽天ブックス";
    const stock = clean($(".status-heading .status").first().text());
    if (stock === "在庫あり") p.availability = "in_stock";
    else if (stock?.includes("予約受付中")) p.availability = "preorder";
    else if (stock && /入荷予約|取り寄せ/.test(stock))
      p.availability = "backorder";
    else if (stock && /ご注文できない|売り切れ|販売終了|在庫なし/.test(stock))
      p.availability = "sold_out";
    if (stock) evidence("availability", "html", stock);

    p.description =
      p.description ||
      clean(
        $(
          '#productDescription,.productDescription,#productDetailedDescription,[itemprop="description"]',
        )
          .first()
          .text(),
      ) ||
      clean(meta("og:description"));
    if ($(".productPrice .freeDelivery").text().includes("送料無料")) {
      p.domesticShipping = {
        amount: 0,
        currency: "JPY",
        condition: "楽天ブックス 商品価格欄: 送料無料",
        payer: "seller",
      };
      evidence("domesticShipping", "html", ".productPrice .freeDelivery");
    }
    const details = $(
      "#productDetailedDescription,#productDetailedInformation,.productInfo",
    ).text();
    p.identifiers = [
      ...new Set([
        ...p.identifiers,
        ...(details.match(/\b(?:97[89]\d{10}|(?:49|45)\d{11})\b/g) || []),
        ...(details.match(/\b[A-Z]{2,6}-\d{3,8}(?:\/\d+)?\b/g) || []),
      ]),
    ];
  }
}
