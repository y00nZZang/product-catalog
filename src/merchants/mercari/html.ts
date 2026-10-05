import type { CheerioAPI } from "cheerio";
import type { Product } from "../../domain";
import type { FieldEvidenceRecorder } from "../shared/types";
import { clean, amount } from "../shared/text";

export function applyMercariHtml(
  $: CheerioAPI,
  p: Product,
  evidence: FieldEvidenceRecorder,
  meta: (key: string) => string | undefined,
) {
  if (p.price === null) {
    p.price = amount(meta("product:price:amount"));
    if (p.price !== null)
      evidence("price", "product_meta", meta("product:price:amount"));
  }
  p.currency = p.currency || clean(meta("product:price:currency"));
  // Only rendered product-scoped elements, never translation dictionaries or recommendation cards.
  p.description =
    p.description || clean($('[data-testid="description"]').first().text());
  const condition = $('[data-testid="商品の状態"]').text();
  if (condition) {
    p.condition = clean(condition);
    evidence("condition", "html", condition);
  }
  const dispatch = $('[data-testid="発送までの日数"]')
    .text()
    .match(/(\d+)\s*[~〜～-]\s*(\d+)日/);
  if (dispatch) {
    p.dispatchDays = { min: Number(dispatch[1]), max: Number(dispatch[2]) };
    evidence("dispatchDays", "html", dispatch[0]);
  }
  p.category = p.category || clean($('[data-testid="カテゴリー"]').text());
  const payer = $('[data-testid="配送料の負担"]').text();
  if (payer.includes("送料込み")) {
    p.domesticShipping = {
      amount: 0,
      currency: "JPY",
      condition: clean(payer),
      payer: "seller",
    };
    evidence("domesticShipping", "html", payer);
  }
}
