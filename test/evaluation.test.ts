import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateManifest } from "../scripts/evaluation/core";
test("evaluation keeps failed/pending cases in coverage and distinguishes agent from human review", () => {
  const base = {
    url: "https://books.rakuten.co.jp/rb/18584086/",
    htmlPath: "test/fixtures/public/rakuten-books-18584086.html",
    reviewerType: "agent",
    reviewedBy: "Codex",
    reviewStatus: "approved",
    expected: { price: 999 },
  };
  const r = evaluateManifest({
    kind: "test",
    samples: [
      base,
      { ...base, reviewStatus: "pending" },
      {
        url: "https://books.rakuten.co.jp/rb/123/",
        captureError: "timeout",
        reviewStatus: "capture_failed",
        expected: {},
      },
    ],
  });
  assert.equal(r.samples, 3);
  assert.equal(r.humanReviewed, 0);
  assert.equal(r.agentReviewed, 1);
  assert.equal(r.counts["rakuten:price"].attempted, 3);
  assert.equal(r.counts["rakuten:price"].scored, 1);
  assert.equal(r.counts["rakuten:price"].wrong, 1);
  assert.equal(r.counts["rakuten:price"].unscored, 2);
});

import { reviewSnapshot } from "../scripts/evaluation/review-snapshot";
import { identify } from "../src/domain";
test("review oracle does not confuse shipping history or related-product prices with missing product price", () => {
  const id = identify("https://jp.mercari.com/item/m1");
  const tail = "<h2>商品の説明</h2><div>送料 ¥750</div><a>同じ商品 ¥2299~</a>";
  const missing = reviewSnapshot(
    '<h1>Card</h1><script type="application/ld+json">{"@type":"Product","offers":{"price":27800}}</script>' +
      tail,
    id,
  );
  assert.equal(missing.expected.price, undefined);
  const displayed = reviewSnapshot(
    "<h1>Card</h1><div>¥ 27,800 (税込) 送料込み</div>" + tail,
    id,
  );
  assert.equal(displayed.expected.price, 27800);
});
