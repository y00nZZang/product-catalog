import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseRatePage,
  parseHskOptions,
  parseInternalTax,
  fetchRates,
} from "../src/customs/tariff/client";
import { resolveTariffs } from "../src/customs/tariff/resolver";
import { tariffReviewReason } from "../src/customs/tariff/policy";
import {
  TARIFF_VERSION,
  TARIFF_SOURCE,
  type ResolvedTariff,
} from "../src/customs/tariff/types";
import { calculateHskTax } from "../src/customs/calculator";
import { automaticTax } from "../src/customs/automatic";
import { emptyProduct } from "../src/domain";
const read = (f: string) => readFileSync("test/fixtures/tariff/" + f, "utf8");
const date = "2026-10-05",
  rates = parseRatePage(read("card.json"), "950440", date).rates;
const basic = rates.find((r) => r.type === "A")!;
const tariff: ResolvedTariff = {
  hsk: basic.hsk,
  name: basic.name,
  rate: basic,
  alternatives: rates,
  internalTaxStatus: "none_listed",
  internalTaxText: "There were no results found.",
  eligible: true,
  reason: null,
  source: TARIFF_SOURCE,
  fetchedAt: "2026-10-05T00:00:00Z",
  referenceDate: date,
  rationale: "단일 HSK",
};
const input = {
  profile: "hsk:9504400000:A",
  route: "express",
  personalUse: true,
  currency: "KRW",
  goods: "1000000",
  domestic: "0",
  international: "0",
  insurance: "0",
  additions: "0",
  shippingSeparated: true,
  fx: {
    jpyToKrw: "8.6131",
    usdToKrw: "1357.14",
    validFrom: "2026-10-04",
    validTo: "2026-10-10",
    referenceDate: date,
  },
  alcohol: null,
};
test("published basic and conditional zero rates remain distinct", () => {
  assert.equal(basic.rate, 8);
  assert.equal(rates.find((r) => r.type === "C")!.rate, 0);
  assert.equal(rates.length, 33);
  assert.ok(!rates.some((r) => r.type === "FEU1" || r.type === "FGB1"));
  assert.equal(
    parseRatePage(read("card.json"), "950440", "2027-01-01").rates.length,
    0,
  );
  assert.throws(() => parseRatePage(read("card.json"), "950300", date));
});
test("missing rate and unit-based rate cannot become zero-duty approval", () => {
  const d = JSON.parse(read("card.json"));
  d.trifHistLst[0].trrt = "";
  const missing = parseRatePage(JSON.stringify(d), "950440", date).rates[0];
  assert.equal(missing.rate, null);
  assert.ok(tariffReviewReason(missing, "none_listed"));
  assert.ok(tariffReviewReason({ ...basic, unitAmount: "100" }, "none_listed"));
  assert.ok(tariffReviewReason({ ...basic, type: "C" }, "none_listed"));
  assert.ok(tariffReviewReason({ ...basic, hsk: "4901990000" }, "none_listed"));
  assert.ok(tariffReviewReason(basic, "review"));
});
test("HSK names retain full official parent paths", () => {
  const r = parseRatePage(read("toy.json"), "950300", date).rates;
  const options = parseHskOptions(read("toy-hierarchy.html"), "950300", r);
  assert.equal(options.length, 34);
  assert.ok(
    options
      .find((x) => x.hsk === "9503002130")!
      .path.includes("사람모형의 인형"),
  );
  assert.ok(
    !options
      .find((x) => x.hsk === "9503003493")!
      .path.includes("사람모형의 인형"),
  );
  assert.throws(() => parseHskOptions("<table></table>", "950300", r));
});
test("internal-tax absence requires the correct detail identity and explicit empty result", () => {
  assert.equal(
    parseInternalTax(read("card-detail.html"), "9504400000").internalTaxStatus,
    "none_listed",
  );
  assert.throws(() => parseInternalTax(read("card-detail.html"), "9503000000"));
  assert.equal(
    parseInternalTax(
      read("card-detail.html").replace(
        "There were no results found.",
        "개별소비세 조건",
      ),
      "9504400000",
    ).internalTaxStatus,
    "review",
  );
});
test("basic calculation never selects the lowest conditional rate; fractional rates use fixed point", () => {
  const r = calculateHskTax(input, tariff);
  assert.equal(r.totalTaxKrw, 188000);
  assert.equal(r.taxes?.duty, 80000);
  assert.equal(
    calculateHskTax(input, { ...tariff, rate: { ...basic, rate: 8.1 } })
      .totalTaxKrw,
    189100,
  );
  assert.throws(() =>
    calculateHskTax(input, {
      ...tariff,
      rate: { ...basic, type: "C", rate: 0 },
    }),
  );
  assert.throws(() =>
    calculateHskTax(input, {
      ...tariff,
      rate: { ...basic, validTo: "2026-01-01" },
    }),
  );
});
test("pagination mismatches fail rather than publish partial tariff data", async () => {
  const d = JSON.parse(read("card.json"));
  d.paginationInfo.currentPageNo = 2;
  await assert.rejects(
    fetchRates("950440", date, "A", async () => JSON.stringify(d)),
  );
});
test("HS-only card candidate reaches tax calculation through official HSK data", async () => {
  const product = {
    ...emptyProduct(),
    title: "ポケモンカード",
    price: 1000000,
    currency: "KRW",
    domesticShipping: { amount: 0, currency: "KRW", condition: null },
  } as any;
  const hs = {
    version: "test",
    source: "test",
    status: "candidate",
    candidates: [
      {
        code: "950440",
        description: "Games; playing cards",
        label: "카드",
        rationale: "카드",
        evidenceQuotes: ["カード"],
      },
    ],
    missingInformation: [],
    rateVerified: false,
    explanation: "후보",
  } as any;
  const snapshot = {
    version: TARIFF_VERSION,
    source: TARIFF_SOURCE,
    referenceDate: date,
    fetchedAt: tariff.fetchedAt,
    prefix: "950440",
    rates: [basic],
    options: parseHskOptions(read("card-hierarchy.html"), "950440", [basic]),
  };
  const resolved = await resolveTariffs(
    product,
    hs,
    { step: async (_s: any, _m: any, _p: any, work: any) => work() } as any,
    undefined,
    date,
    {
      snapshot: async () => snapshot,
      detail: async () => ({
        alternatives: rates,
        internalTaxStatus: "none_listed" as const,
        internalTaxText: "There were no results found.",
      }),
    },
  );
  assert.equal(resolved.status, "available");
  const result = automaticTax(
    product,
    null,
    {
      candidates: [],
      unsupported: true,
      hsClassification: hs,
      alcohol: { bottles: null, mlPerBottle: null, abv: null },
    } as any,
    {
      ...input.fx,
      source: "fixture",
      sourceKind: "official_public",
      retrievedAt: tariff.fetchedAt,
      warnings: [],
    } as any,
    null,
    resolved,
  );
  assert.equal(result.taxRangeKrw?.min, 188000);
  assert.equal(result.publicTariffApplied, true);
  assert.equal(result.status, "partial");
});

test("fractional duty also preserves the high-value review boundary", () => {
  const bag = {
    ...tariff,
    hsk: "4202221010",
    name: "합성 가방 표본",
    rate: { ...basic, hsk: "4202221010", rate: 8.1 },
  };
  assert.equal(
    calculateHskTax({ ...input, profile: "hsk:4202221010:A" }, bag).totalTaxKrw,
    189100,
  );
  assert.equal(
    calculateHskTax(
      { ...input, profile: "hsk:4202221010:A", goods: "3000000" },
      bag,
    ).totalTaxKrw,
    null,
  );
});

test("trade-remedy or higher conditional duties cannot silently fall back to the basic rate", () => {
  const remedy = { ...basic, type: "I", rate: 20 };
  assert.ok(tariffReviewReason(basic, "none_listed", [basic, remedy]));
  assert.throws(() =>
    calculateHskTax(input, { ...tariff, alternatives: [basic, remedy] }),
  );
  assert.ok(
    tariffReviewReason(basic, "none_listed", [
      basic,
      { ...basic, type: "B", rate: 12 },
    ]),
  );
});

test("a blocked public duty cannot be bypassed using the legacy toy profile", () => {
  const blocked = {
    ...tariff,
    eligible: false,
    reason: "추가 관세 검토",
    alternatives: [basic, { ...basic, type: "I", rate: 20 }],
  };
  const result = automaticTax(
    { ...emptyProduct(), title: "toy", price: 1000000, currency: "KRW" },
    null,
    {
      candidates: [{ profile: "toy" }],
      unsupported: false,
      alcohol: { bottles: null, mlPerBottle: null, abv: null },
    } as any,
    {
      ...input.fx,
      source: "fixture",
      sourceKind: "official_public",
      retrievedAt: tariff.fetchedAt,
      warnings: [],
    } as any,
    null,
    {
      version: TARIFF_VERSION,
      referenceDate: date,
      window: 0,
      status: "needs_review",
      candidates: [blocked],
      missingInformation: [],
    },
  );
  assert.equal(result.taxRangeKrw, null);
});
