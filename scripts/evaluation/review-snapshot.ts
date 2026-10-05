import { load } from "cheerio";
import { Identity } from "../../src/domain";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export function reviewSnapshot(html: string, id: Identity) {
  const $ = load(html),
    chunks: string[] = [];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const records: Record<string, string> = {};
  const expected: Record<string, unknown> = {};
  const heading = id.externalId.startsWith("books:")
    ? $('h1[itemprop="name"]').first()
    : $("h1").first();
  records.title =
    clean(
      heading
        .contents()
        .filter((_, n) => n.type === "text")
        .text(),
    ) || clean(heading.text());
  if (records.title) expected.title = records.title;
  const content = $("body").clone();
  content.find("script,style,nav,header,footer").remove();
  const visible = clean(content.text());
  const buttons = $("button")
    .map((_, e) => clean($(e).text()))
    .get();
  if (id.externalId.startsWith("books:")) {
    records.price = clean($('.productPrice [itemprop="price"]').first().text());
    records.availability = clean($(".status-heading .status").first().text());
    records.shipping = clean($(".productPrice .freeDelivery").text());
    const n = records.price.match(/([\d,]+)\s*円/);
    if (n) {
      expected.price = Number(n[1].replace(/,/g, ""));
      expected.currency = "JPY";
    }
    if (records.availability === "在庫あり") expected.availability = "in_stock";
    else if (/予約受付中/.test(records.availability))
      expected.availability = "preorder";
    else if (
      /ご注文できない|売り切れ|販売終了|在庫なし/.test(records.availability)
    )
      expected.availability = "sold_out";
    else if (/入荷予約|取り寄せ/.test(records.availability))
      expected.availability = "backorder";
    if (records.shipping === "送料無料") expected.domesticShippingAmount = 0;
  } else if (id.platform === "mercari") {
    const taxBoundary = visible.indexOf("(税込)");
    const n =
      taxBoundary >= 0
        ? visible.slice(0, taxBoundary).match(/(?:¥|￥)\s*([\d,]+)/)
        : null;
    records.price = n?.[0] || "";
    if (n) {
      expected.price = Number(n[1].replace(/,/g, ""));
      expected.currency = "JPY";
    }
    records.purchase = buttons
      .filter((t) => /購入手続き|売り切れ|入札/.test(t))
      .join(" / ");
    if (buttons.includes("入札する")) {
      expected.price = null;
      records.saleType = "auction";
    }
    if (buttons.includes("購入手続きへ")) expected.availability = "in_stock";
    else if (
      buttons.some((t) => /売り切れました/.test(t)) ||
      content
        .find("*")
        .toArray()
        .some(
          (e) =>
            $(e).children().length === 0 &&
            clean($(e).text()) === "売り切れました",
        )
    )
      expected.availability = "sold_out";
    records.condition = clean($('[data-testid="商品の状態"]').text());
    if (records.condition) expected.condition = records.condition;
    records.shipping = clean($('[data-testid="配送料の負担"]').text());
    if (records.shipping.includes("送料込み"))
      expected.domesticShippingAmount = 0;
    records.dispatch = clean($('[data-testid="発送までの日数"]').text());
  }
  // Capture public product-only DOM and product JSON-LD. Never headers, application state, reviews or personal/session identifiers.
  for (const name of [
    "og:title",
    "og:image",
    "product:price:amount",
    "product:price:currency",
  ]) {
    const value = $(`meta[property="${name}"],meta[name="${name}"]`)
      .first()
      .attr("content");
    if (value) chunks.push(`<meta property="${name}" content="${esc(value)}">`);
  }
  const selectors = [
    'h1[itemprop="name"]',
    "h1:not([itemprop])",
    ".productPrice",
    ".status-heading",
    "#productDetailedDescription",
    '[data-testid="description"]',
    '[data-testid="商品の状態"]',
    '[data-testid="配送料の負担"]',
    '[data-testid="発送までの日数"]',
    '[data-testid="item-detail-category"]',
  ];
  for (const selector of selectors) {
    $(selector)
      .first()
      .each((_, e) => {
        const clone = $(e).clone();
        clone.find("script,style,iframe,input").remove();
        clone
          .find("*")
          .addBack()
          .each((_, node) => {
            for (const attr of Object.keys(
              "attribs" in node ? node.attribs : {},
            ))
              if (
                !["class", "id", "itemprop", "content", "data-testid"].includes(
                  attr,
                )
              )
                clone
                  .find("*")
                  .addBack()
                  .filter((_, n) => n === node)
                  .removeAttr(attr);
          });
        chunks.push($.html(clone));
      });
  }
  for (const text of buttons.filter((t) => /購入手続き|売り切れ|入札/.test(t)))
    chunks.push(`<button>${esc(text)}</button>`);
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const visit = (value: any) => {
        if (!value || typeof value !== "object") return;
        if ([].concat(value["@type"] || []).includes("Product" as never)) {
          const pick: any = {};
          for (const key of [
            "@type",
            "@id",
            "url",
            "name",
            "description",
            "image",
            "category",
            "gtin",
            "gtin13",
            "gtin12",
            "mpn",
            "isbn",
            "itemCondition",
          ])
            if (value[key] != null) pick[key] = value[key];
          pick.offers = [].concat(value.offers || []).map((o: any) => {
            const offer: any = {};
            for (const key of [
              "@type",
              "price",
              "lowPrice",
              "highPrice",
              "priceCurrency",
              "availability",
              "itemCondition",
            ])
              if (o[key] != null) offer[key] = o[key];
            return offer;
          });
          chunks.push(
            `<script type="application/ld+json">${JSON.stringify(pick).replace(/</g, "\\u003c")}</script>`,
          );
        } else
          for (const child of Object.values(value))
            if (Array.isArray(child)) child.forEach(visit);
            else visit(child);
      };
      visit(JSON.parse($(e).text()));
    } catch {}
  });
  return {
    html:
      '<!doctype html><html lang="ja"><body>\n' +
      chunks.join("\n") +
      "\n</body></html>",
    expected,
    evidence: records,
  };
}
