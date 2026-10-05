import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identify,
  emptyProduct,
  packageSchema,
  CatalogError,
} from "../src/domain";
import { parseHtml } from "../src/merchants/html";
import {
  parseRakutenApi,
  resolveRakutenItemCode,
} from "../src/merchants/rakuten/ichiba";
import {
  publicIp,
  checkStatus,
  retryAfter,
  checkChallenge,
  rakutenAccessError,
} from "../src/ingestion/transport";
import {
  quotePackage,
  dimensionalWeight,
  rates,
  tier,
} from "../src/shipping/calculator";

test("Rakuten IP rejection is actionable without exposing upstream secrets", () => {
  const error = rakutenAccessError(
    JSON.stringify({
      errors: { errorCode: 403, errorMessage: "CLIENT_IP_NOT_ALLOWED" },
    }),
  );
  assert.equal(error.code, "rakuten_ip_not_allowed");
  assert.equal(error.retryable, false);
  for (const body of [
    "<html>denied</html>",
    JSON.stringify({ errors: { errorMessage: "secret-like upstream value" } }),
  ]) {
    assert.equal(rakutenAccessError(body).message, "access_denied");
  }
});

test("known tracking variants share identity, unknown query options do not", () => {
  const a = identify(
    "https://item.rakuten.co.jp/shop/record/?utm_source=x#detail",
  );
  assert.equal(a.key, identify("https://item.rakuten.co.jp/shop/record/").key);
  assert.notEqual(
    a.key,
    identify("https://item.rakuten.co.jp/shop/record/?variant=blue").key,
  );
  assert.notEqual(
    a.key,
    identify("https://item.rakuten.co.jp/other/record/").key,
  );
  assert.equal(
    identify("https://jp.mercari.com/item/m123/?utm_source=link").key,
    identify("https://jp.mercari.com/item/m123").key,
  );
});
test("reject SSRF and malformed URL inputs", () => {
  for (const url of [
    "http://jp.mercari.com/item/m1",
    "https://jp.mercari.com.evil.test/item/m1",
    "https://127.0.0.1/",
    "https://user:pass@jp.mercari.com/item/m1",
    "https://jp.mercari.com:444/item/m1",
    "https://item.rakuten.co.jp/a/%2e%2e/",
  ])
    assert.throws(() => identify(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
  ])
    assert.equal(publicIp(ip), false, ip);
  assert.equal(publicIp("8.8.8.8"), true);
});
test("status classification and Retry-After", () => {
  assert.equal(retryAfter("120"), 120000);
  assert.equal(retryAfter(new Date(10000).toUTCString(), 0), 10000);
  assert.throws(
    () => checkStatus(429, { "retry-after": "10" }),
    (e: any) => e.retryable && e.retryAfterMs === 10000,
  );
  assert.throws(
    () => checkStatus(403),
    (e: any) => e.code === "access_denied" && !e.retryable,
  );
  assert.throws(
    () => checkStatus(503),
    (e: any) => e.retryable,
  );
  assert.throws(
    () => checkChallenge("<title>Just a moment...</title>"),
    CatalogError,
  );
});
test("book microdata uses sale price, not discount or recommendations", () => {
  const html =
    '<h1 itemprop="name">Album Blu-ray</h1><p class="productPrice"><span>6600円</span><span itemprop="price" content="5672">5,672円</span><meta itemprop="priceCurrency" content="JPY"><span class="freeDelivery">送料無料</span></p><aside><span class="price">999円</span></aside>';
  const p = parseHtml(html, identify("https://books.rakuten.co.jp/rb/123/"));
  assert.equal(p.price, 5672);
  assert.equal(p.domesticShipping.amount, 0);
  assert.equal(p.availability, "unknown");
});
test("metadata never invents stock, seller, shipping, or description from site marketing", () => {
  const p = parseHtml(
    '<meta property="og:title" content="Album by メルカリ"><meta property="product:price:amount" content="4500"><meta property="product:price:currency" content="JPY"><meta property="og:description" content="All products free!">',
    identify("https://jp.mercari.com/item/m1"),
  );
  assert.equal(p.title, "Album");
  assert.equal(p.price, 4500);
  assert.equal(p.description, null);
  assert.equal(p.domesticShipping.amount, null);
  assert.equal(p.availability, "unknown");
});
test("multiple products and aggregate offers never silently pick a low price", () => {
  const id = identify("https://item.rakuten.co.jp/shop/item/");
  const p = parseHtml(
    '<meta property="og:title" content="Variants"><script type="application/ld+json">' +
      JSON.stringify({
        "@type": "Product",
        name: "Variants",
        offers: { "@type": "AggregateOffer", lowPrice: 1000, highPrice: 3000 },
      }) +
      "</script>",
    id,
  );
  assert.equal(p.price, null);
  assert.ok(p.warnings.includes("multiple_or_aggregate_offers"));
});
test("option prices not assumed from generic page or API", () => {
  const p = parseHtml(
    '<h1>Album</h1><span itemprop="price" content="1000"></span>',
    identify("https://item.rakuten.co.jp/shop/item/?sku=2"),
  );
  assert.equal(p.price, null);
});
test("API selects exact shop:item identity", () => {
  const id = identify("https://item.rakuten.co.jp/shop/123/");
  assert.throws(() =>
    parseRakutenApi(
      { Items: [{ Item: { itemCode: "other:123", itemName: "Wrong" } }] },
      id,
    ),
  );
  const p = parseRakutenApi(
    {
      Items: [
        {
          Item: {
            itemCode: "shop:123",
            itemUrl: "https://item.rakuten.co.jp/shop/123/",
            itemName: "Album",
            itemPrice: 1200,
            availability: 0,
            postageFlag: 1,
          },
        },
      ],
    },
    id,
  );
  assert.equal(p.availability, "sold_out");
  assert.equal(p.domesticShipping.amount, null);
});
const pkg = {
  weightGrams: 250,
  lengthCm: 19,
  widthCm: 14,
  heightCm: 2,
  basis: "user_assumption" as const,
  source: "test",
  assumptions: [],
};
test("rate boundary and mandatory fees", () => {
  const book = { ...rates, checkedAt: new Date().toISOString().slice(0, 10) };
  const q = quotePackage(pkg, emptyProduct(), book);
  assert.equal(q.quotes[0].knownSubtotal, 1800);
  assert.equal(q.quotes[1].knownSubtotal, 15.63);
  assert.equal(q.quotes[1].status, "partial");
  assert.equal(q.comparisonReady, false);
  assert.equal(tier(500, rates.tenso.freight), 1450);
  assert.equal(tier(501, rates.tenso.freight), 1600);
  assert.equal(tier(5001, rates.tenso.freight), null);
  assert.equal(
    quotePackage({ ...pkg, lengthCm: 151 }, emptyProduct(), book).quotes[0]
      .status,
    "unsupported",
  );
  assert.equal(
    quotePackage(pkg, emptyProduct(), { ...book, checkedAt: "2000-01-01" })
      .quotes[0].knownSubtotal,
    null,
  );
  assert.equal(
    dimensionalWeight(
      { ...pkg, lengthCm: 50, widthCm: 40, heightCm: 30 },
      5000,
    ),
    12000,
  );
  assert.throws(() => packageSchema.parse({ ...pkg, weightGrams: 0 }));
});
// Synthetic variation regression, NOT 30 human-reviewed live samples per site.
for (const platform of ["rakuten", "mercari"] as const)
  for (let n = 0; n < 30; n++)
    test(`synthetic ${platform} ${n}: price/stock/null preservation`, () => {
      const id = identify(
        platform === "rakuten"
          ? `https://item.rakuten.co.jp/test/album-${n}/`
          : `https://jp.mercari.com/item/m${n + 100}`,
      );
      const price = n % 5 === 0 ? null : 1000 + n;
      const product: any = {
        "@type": "Product",
        name: `Album ${n}`,
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: "JPY",
          availability:
            n % 2 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        },
      };
      const p = parseHtml(
        `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
        id,
      );
      assert.equal(p.price, price);
      assert.equal(p.title, `Album ${n}`);
      assert.equal(p.availability, n % 2 ? "in_stock" : "sold_out");
      assert.equal(p.domesticShipping.amount, null);
    });

test("auction bid and unrelated Product JSON-LD are not sale prices", () => {
  const id = identify("https://jp.mercari.com/item/m1");
  const auction = parseHtml(
    '<meta property="og:title" content="Auction"><meta property="product:price:amount" content="300"><button>入札する</button>',
    id,
  );
  assert.equal(auction.price, null);
  assert.ok(auction.warnings.includes("auction_price_requires_review"));
  const unrelated = parseHtml(
    '<meta property="og:title" content="Main product"><script type="application/ld+json">' +
      JSON.stringify({
        "@type": "Product",
        url: "https://jp.mercari.com/item/m2",
        name: "Recommendation",
        offers: { price: 500, currency: "JPY" },
      }) +
      "</script>",
    id,
  );
  assert.equal(unrelated.title, "Main product");
  assert.equal(unrelated.price, null);
});

test("Rakuten URL management number differs from API item code", () => {
  const id = identify("https://item.rakuten.co.jp/xexymix/cpxp9167f/");
  assert.equal(
    resolveRakutenItemCode('"itemCode":"xexymix:10001192"', id),
    "xexymix:10001192",
  );
  assert.equal(
    resolveRakutenItemCode("xexymix:10001192 xexymix:10002000", id),
    null,
  );
  assert.equal(resolveRakutenItemCode("other:10001192", id), null);
  const item = {
    itemCode: "xexymix:10001192",
    itemUrl: "https://item.rakuten.co.jp/xexymix/cpxp9167f/?rafcid=tracking",
    itemName: "Leggings",
    itemPrice: 7700,
    availability: 1,
  };
  for (const payload of [{ Items: [item] }, { items: [{ item }] }]) {
    const p = parseRakutenApi(payload, id, "xexymix:10001192");
    assert.equal(p.price, 7700);
    assert.equal(p.apiItemCode, "xexymix:10001192");
  }
  assert.throws(
    () =>
      parseRakutenApi(
        {
          Items: [
            {
              ...item,
              itemUrl: "https://item.rakuten.co.jp/xexymix/different/",
            },
          ],
        },
        id,
        "xexymix:10001192",
      ),
    (e: any) => e.code === "api_identity_mismatch",
  );
  assert.throws(() =>
    parseRakutenApi(
      { Items: [{ ...item, itemUrl: undefined }] },
      id,
      "xexymix:10001192",
    ),
  );
});
