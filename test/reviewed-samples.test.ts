import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHtml } from "../src/merchants/html";
import { identify } from "../src/domain";
const manifest = JSON.parse(
  readFileSync("test/fixtures/reviewed-2026-09-22/manifest.json", "utf8"),
);
for (const sample of manifest.samples)
  test("reviewed real merchant: " + sample.url, () => {
    assert.equal(sample.reviewStatus, "approved");
    assert.equal(sample.reviewerType, "agent");
    const p = parseHtml(
      readFileSync(sample.htmlPath, "utf8"),
      identify(sample.url),
    );
    const actual = { ...p, domesticShippingAmount: p.domesticShipping.amount };
    for (const [field, value] of Object.entries(sample.expected))
      assert.deepEqual((actual as any)[field], value, field);
  });
test("known Rakuten tracking and transport flags do not split a listing", () => {
  const a = identify("https://books.rakuten.co.jp/rb/18602198/");
  assert.equal(a.key, identify(a.canonicalUrl + "?bkts=1&l-id=ranking").key);
  assert.notEqual(a.key, identify(a.canonicalUrl + "?edition=2").key);
  assert.notEqual(
    identify("https://item.rakuten.co.jp/shop/a/?bkts=1").key,
    identify("https://item.rakuten.co.jp/shop/a/").key,
  );
});
