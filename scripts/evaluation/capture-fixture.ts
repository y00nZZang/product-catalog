import { load } from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";
import { identify } from "../../src/domain";
import { safeGet, browserGet } from "../../src/ingestion/transport";
(async () => {
  const [url, mode] = process.argv.slice(2);
  const id = identify(url);
  const r =
    mode === "browser"
      ? await browserGet(id)
      : await safeGet(id.canonicalUrl, undefined, {}, id);
  const $ = load(r.html);
  const parts: string[] = [];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  for (const key of [
    "og:title",
    "og:image",
    "product:price:amount",
    "product:price:currency",
  ]) {
    const value = $(`meta[property="${key}"]`).attr("content");
    if (value) parts.push(`<meta property="${key}" content="${esc(value)}">`);
  }
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const value = JSON.parse($(e).text());
      const visit = (x: any) => {
        if (!x || typeof x !== "object") return;
        if (x["@type"] === "Product") {
          const pick: any = {};
          for (const k of [
            "@type",
            "name",
            "description",
            "image",
            "url",
            "gtin13",
            "mpn",
            "category",
            "itemCondition",
          ])
            if (x[k]) pick[k] = x[k];
          const offers = [].concat(x.offers || []).map((o: any) => {
            const p: any = {};
            for (const k of [
              "@type",
              "price",
              "priceCurrency",
              "availability",
              "itemCondition",
            ])
              if (o[k] != null) p[k] = o[k];
            return p;
          });
          pick.offers = offers;
          parts.push(
            `<script type="application/ld+json">${JSON.stringify(pick).replace(/</g, "\\u003c")}</script>`,
          );
        } else
          for (const child of Object.values(x))
            if (Array.isArray(child)) child.forEach(visit);
            else visit(child);
      };
      visit(value);
    } catch {}
  });
  for (const selector of [
    'h1[itemprop="name"]',
    '[itemprop="price"]',
    '[itemprop="priceCurrency"]',
    "#productDetailedDescription",
    '[data-testid="description"]',
    '[data-testid="商品の状態"]',
    '[data-testid="配送料の負担"]',
    '[data-testid="発送までの日数"]',
    '[data-testid="カテゴリー"]',
  ]) {
    $(selector)
      .first()
      .each((_, e) => {
        const attrs = ["itemprop", "content", "id", "data-testid"]
          .filter((k) => $(e).attr(k))
          .map((k) => `${k}="${esc($(e).attr(k)!)}"`)
          .join(" ");
        parts.push(
          `<div ${attrs}>${esc($(e).clone().find("script").remove().end().text())}</div>`,
        );
      });
  }
  if ($(".productPrice .freeDelivery").text().includes("送料無料"))
    parts.push(
      '<div class="productPrice"><span class="freeDelivery">送料無料</span></div>',
    );
  mkdirSync("test/fixtures/public", { recursive: true });
  const name = id.platform + "-" + id.externalId.replace(/[^a-z0-9-]/gi, "-");
  const path = `test/fixtures/public/${name}.html`;
  writeFileSync(
    path,
    '<!doctype html><html lang="ja"><body>\n' +
      parts.join("\n") +
      "\n</body></html>",
  );
  writeFileSync(
    path + ".json",
    JSON.stringify(
      {
        source: id.canonicalUrl,
        capturedAt: new Date().toISOString(),
        method: mode || "http",
        scope:
          "Selected public product markup only. Session data, scripts, user identifiers and headers omitted.",
      },
      null,
      2,
    ),
  );
  console.log(path);
})().catch(() => {
  console.error("Fixture capture failed");
  process.exitCode = 1;
});
