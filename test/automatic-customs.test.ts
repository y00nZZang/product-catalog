import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePublicFx,
  parseApiFx,
  validateFx,
  weekStart,
  type CustomsFx,
} from "../src/customs/fx";
import { automaticTax } from "../src/customs/automatic";
import { ruleClassify } from "../src/customs/classifier";
import { emptyProduct } from "../src/domain";
const fx: CustomsFx = {
  jpyToKrw: "10",
  usdToKrw: "1000",
  validFrom: "2026-09-27",
  validTo: "2026-10-03",
  referenceDate: "2026-10-01",
  source: "https://example.test/customs",
  sourceKind: "official_api",
  retrievedAt: "2026-10-01T00:00:00Z",
  warnings: [],
};
const product = {
  ...emptyProduct(),
  title: "ワイン 750ml 14% 1本",
  price: 30000,
  currency: "JPY",
  domesticShipping: {
    amount: 0,
    currency: "JPY",
    condition: "送料込み",
    payer: "seller",
  },
};
const pkg = {
  weightGrams: 1000,
  lengthCm: 20,
  widthCm: 15,
  heightCm: 30,
  basis: "estimated",
  source: "fixture",
  assumptions: ["synthetic"],
};
test("official public FX fixture validates currency, import column and full applicable week", () => {
  const html = readFileSync(
      "test/fixtures/customs-fx/public-2026-10-01.html",
      "utf8",
    ),
    json = JSON.parse(
      readFileSync("test/fixtures/customs-fx/public-2026-10-01.json", "utf8"),
    );
  const r = parsePublicFx(html, json, "2026-10-01");
  assert.equal(r.jpyToKrw, "8.7484");
  assert.equal(r.usdToKrw, "1376.03");
  assert.equal(r.validTo, "2026-10-03");
  assert.throws(() => parsePublicFx(html, json, "2026-10-04"));
  assert.throws(() =>
    parsePublicFx(html, { items: [json.items[0]] }, "2026-10-01"),
  );
  assert.throws(() =>
    parsePublicFx(
      html,
      { items: [...json.items, json.items[0]] },
      "2026-10-01",
    ),
  );
});
test("OpenAPI XML reads import rates only and rejects error or stale periods", () => {
  const xml =
    "<response><resultCode>00</resultCode><items><item><currSgn>JPY</currSgn><aplyBgnDt>20260927</aplyBgnDt><fxrt>8.7484</fxrt><imexTp>2</imexTp></item><item><currSgn>USD</currSgn><aplyBgnDt>20260927</aplyBgnDt><fxrt>1376.03</fxrt><imexTp>2</imexTp></item></items></response>";
  assert.equal(parseApiFx(xml, "2026-10-01").usdToKrw, "1376.03");
  assert.throws(() =>
    parseApiFx(xml.replaceAll("<imexTp>2", "<imexTp>1"), "2026-10-01"),
  );
  assert.throws(() => parseApiFx(xml.replace(">00<", ">30<"), "2026-10-01"));
  assert.throws(() => parseApiFx("<!DOCTYPE response>" + xml, "2026-10-01"));
  assert.equal(weekStart("2026-10-04"), "2026-10-04");
  assert.throws(() => validateFx(fx, "2026-10-04"));
});
test("URL information produces reviewed tax and costs without fabricating user confirmation", () => {
  const result = automaticTax(
    product,
    { package: pkg },
    ruleClassify(product),
    fx,
  );
  assert.equal(result.scenarios.length, 2);
  assert.ok(result.taxRangeKrw);
  assert.ok(result.knownTotalRangeKrw);
  assert.equal(result.requiresReview, true);
  const tax = result.scenarios[0].tax;
  assert.ok(tax && "input" in tax);
  assert.equal(tax.input.route, "postal_general");
  assert.equal("confirmed" in tax.input, false);
  assert.equal(result.scenarios[0].tax?.fx.basis, "official_api");
  assert.equal(result.status, "partial");
  assert.equal(result.rangeComplete, false);
});
test("missing freight/domestic costs remain explicitly incomplete; zero is never a complete total", () => {
  const p = { ...emptyProduct(), title: "玩具", price: 1000, currency: "JPY" };
  const r = automaticTax(p, null, ruleClassify(p), fx);
  assert.equal(r.taxRangeKrw?.min, 0);
  assert.equal(r.rangeComplete, false);
  assert.equal(r.status, "partial");
  assert.ok(r.missingInformation.length >= 2);
});
test("missing FX, unsupported classification and missing price return reasons, not invented amounts", () => {
  for (const r of [
    automaticTax(product, null, ruleClassify(product), null, "timeout"),
    automaticTax({ ...product, price: null }, null, ruleClassify(product), fx),
    automaticTax(
      { ...product, title: "empty bottle" },
      null,
      ruleClassify({ ...product, title: "empty bottle" }),
      fx,
    ),
  ]) {
    assert.equal(r.status, "needs_information");
    assert.equal(r.taxRangeKrw, null);
    assert.ok(r.missingInformation.length);
  }
});
test("alcohol unknown volume or ambiguous bundle is not silently treated as one exempt bottle", () => {
  for (const title of ["ワイン 14%", "ワイン 750ml 14% セット"]) {
    const p = { ...product, title };
    const r = automaticTax(p, { package: pkg }, ruleClassify(p), fx);
    assert.equal(r.taxRangeKrw, null);
  }
  const p = { ...product, title: "ワイン 750ml 14%" };
  const r = automaticTax(p, { package: pkg }, ruleClassify(p), fx);
  assert.ok(r.taxRangeKrw);
  assert.ok(r.scenarios[0].missingCosts.some((x) => x.includes("1병 가정")));
});
test("multiple classification candidates and package bounds produce separate scenarios", () => {
  const p = { ...product, title: "ぬいぐるみ クッション" };
  const ranges = Object.fromEntries(
    Object.entries({
      weightGrams: 1000,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 30,
    }).map(([k, v]) => [k, { low: v * 0.8, typical: v, high: v * 1.2 }]),
  );
  const r = automaticTax(p, { package: pkg, ranges }, ruleClassify(p), fx);
  assert.equal(r.scenarios.length, 12);
  assert.ok(r.taxRangeKrw);
});
