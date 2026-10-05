import { ZodError } from "zod";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateTax } from "../src/customs/calculator";
import {
  classifyTax,
  ruleClassify,
  extractAlcohol,
} from "../src/customs/classifier";
import { emptyProduct } from "../src/domain";
import type { TaxInput } from "../src/customs/schema";
import { Recorder } from "../src/jobs/recorder";
const dataset = JSON.parse(
  readFileSync("test/fixtures/customs/products.json", "utf8"),
);
for (const sample of dataset.samples)
  test(`customs classification ${sample.kind}: ${sample.id}`, () => {
    const p = {
      ...emptyProduct(),
      title: sample.title,
      description: sample.description,
    };
    const r = ruleClassify(p);
    assert.deepEqual(
      r.candidates.map((c) => c.profile),
      sample.expected,
    );
    if (sample.unsupported) assert.equal(r.unsupported, true);
    if ("ml" in sample) assert.equal(r.alcohol.mlPerBottle, sample.ml);
    if ("bottles" in sample) assert.equal(r.alcohol.bottles, sample.bottles);
    if ("abv" in sample) assert.equal(r.alcohol.abv, sample.abv);
  });
function input(profile: TaxInput["profile"] = "toy"): TaxInput {
  return {
    profile,
    confirmed: true,
    observationId: "00000000-0000-4000-8000-000000000001",
    classificationId: "00000000-0000-4000-8000-000000000002",
    route: "express",
    personalUse: true,
    currency: "USD",
    goods: "200",
    domestic: "0",
    international: "0",
    insurance: "0",
    additions: "0",
    shippingSeparated: true,
    fx: {
      jpyToKrw: "10",
      usdToKrw: "1000",
      validFrom: "2026-09-27",
      validTo: "2026-10-03",
      referenceDate: "2026-09-30",
    },
    alcohol: { bottles: 1, mlPerBottle: 750, abv: 40 },
  };
}
test("general above threshold taxes entire base, not only excess", () => {
  const r = calculateTax({ ...input(), international: "20" });
  assert.equal(r.totalTaxKrw, 41360);
  assert.deepEqual(r.taxes, {
    duty: 17600,
    liquor: 0,
    education: 0,
    vat: 23760,
  });
});
test("precise 150 USD boundary and domestic/additional costs", () => {
  for (const goods of ["149.99", "150"])
    assert.equal(calculateTax({ ...input(), goods }).totalTaxKrw, 0);
  assert.equal(calculateTax({ ...input(), goods: "150.01" }).exemption, false);
  assert.equal(
    calculateTax({ ...input(), goods: "149", domestic: "2" }).exemption,
    false,
  );
  assert.equal(
    calculateTax({ ...input(), goods: "149", additions: "2" }).exemption,
    false,
  );
  assert.equal(
    calculateTax({ ...input(), goods: "149", international: "100" })
      .totalTaxKrw,
    0,
  );
  assert.equal(
    calculateTax({
      ...input(),
      goods: "149",
      international: "100",
      shippingSeparated: false,
    }).exemption,
    false,
  );
});
test("wine, whisky and sake basic-rate arithmetic above threshold", () => {
  for (const [profile, total, liquor, education, vat] of [
    ["wine", 180380, 78000, 7800, 34580],
    ["sake", 180380, 78000, 7800, 34580],
    ["whisky", 353696, 187200, 56160, 50336],
  ] as const) {
    const r = calculateTax(input(profile));
    assert.equal(r.totalTaxKrw, total);
    assert.deepEqual(r.taxes, { duty: 60000, liquor, education, vat });
  }
});
test("alcohol low-value exemption never removes liquor and education tax", () => {
  const r = calculateTax({ ...input("whisky"), goods: "100" });
  assert.deepEqual(r.taxes, {
    duty: 0,
    liquor: 72000,
    education: 21600,
    vat: 0,
  });
  assert.equal(r.totalTaxKrw, 93600);
  assert.equal(
    calculateTax({ ...input("wine"), goods: "100" }).totalTaxKrw,
    33000,
  );
});
test("alcohol exemption limited to one bottle and 1L, all price taxed on exceeding volume", () => {
  const r = input("wine");
  r.goods = "100";
  r.alcohol!.mlPerBottle = 1000;
  assert.equal(calculateTax(r).exemption, true);
  r.alcohol!.mlPerBottle = 1001;
  assert.equal(calculateTax(r).exemption, false);
  r.alcohol!.mlPerBottle = 750;
  r.alcohol!.bottles = 2;
  assert.equal(calculateTax(r).exemption, false);
});
test("missing alcohol facts, low ABV, postal route, stale rates and non-personal use are not zero-tax successes", () => {
  const cases = [
    { ...input("wine"), alcohol: null },
    { ...input("wine"), alcohol: { bottles: 1, mlPerBottle: 750, abv: 8.5 } },
    { ...input(), route: "postal" as const },
    { ...input(), personalUse: false },
    { ...input(), fx: { ...input().fx, referenceDate: "2026-11-01" } },
  ];
  for (const c of cases) {
    const r = calculateTax(c);
    assert.equal(r.status, "needs_review");
    assert.equal(r.totalTaxKrw, null);
  }
});
test("monetary validation and decimal cross-currency threshold do not use binary float", () => {
  assert.throws(() => calculateTax({ ...input(), goods: "-1" }));
  assert.throws(() => calculateTax({ ...input(), goods: "NaN" }));
  assert.equal(
    calculateTax({ ...input(), currency: "JPY", goods: "15000" }).exemption,
    true,
  );
  assert.equal(
    calculateTax({ ...input(), currency: "JPY", goods: "15000.01" }).exemption,
    false,
  );
});
test("ABV extraction never uses sake rice polishing ratio or silently assumes bottle count", () => {
  assert.equal(extractAlcohol("純米 精米歩合45% 720ml").abv, null);
  assert.equal(extractAlcohol("whisky 700ml 43%").bottles, null);
});
test("LLM fallback selects curated profiles, rejects fabricated quotes and ignores guessed alcohol facts", async () => {
  const p = {
    ...emptyProduct(),
    title: "黄色いキャラクター 抱き枕",
    description: "やわらかい 綿入り",
  }; // Multiple/unknown profiles forced below.
  p.title = "黄色いキャラクター";
  const caller: any = {
    call: async () => ({
      output_parsed: {
        candidates: [
          {
            profile: "cushion",
            evidenceQuotes: ["やわらかい 綿入り"],
            rationale: "用途を確認",
          },
          { profile: "whisky", evidenceQuotes: ["invented"], rationale: "bad" },
        ],
        alcohol: { bottles: 1, mlPerBottle: 700, abv: 43, evidenceQuotes: [] },
        missingInformation: ["用途"],
        explanation: "推定",
        unsupported: false,
      },
    }),
  };
  const out = await classifyTax(p, "", new Recorder("unused"), caller);
  assert.equal(out.method, "llm");
  assert.deepEqual(
    out.candidates.map((c) => c.profile),
    ["cushion"],
  );
  assert.equal(out.alcohol.abv, null);
});

test("full-width alcohol facts normalize without interpreting wine glasses as wine", () => {
  assert.equal(
    extractAlcohol("ウイスキー ７００ｍｌ ４３％ １本").mlPerBottle,
    700,
  );
  assert.equal(
    ruleClassify({ ...emptyProduct(), title: "ワイングラス 750ml" })
      .unsupported,
    true,
  );
});

test("official calculator catalog is complete for the captured menu, not a catch-all HSK table", async () => {
  const { profiles, taxMetadata } = await import("../src/customs/profiles.js");
  const meta = taxMetadata();
  assert.equal(meta.coverage.catalogItems, 137);
  assert.equal(Object.keys(profiles).length, 137);
  assert.equal(
    new Set(Object.values(profiles).map((p) => p.officialItem)).size,
    137,
  );
  assert.equal(
    meta.coverage.calculableProfiles + meta.coverage.reviewProfiles,
    137,
  );
  assert.equal(meta.coverage.completeHskCoverage, false);
  for (const p of Object.values(profiles)) {
    assert.ok(Number.isFinite(p.duty));
    assert.ok(p.rateEvidence);
    if (p.calculationStatus === "needs_review") assert.ok(p.reviewReason);
  }
  assert.throws(() => calculateTax({ ...input(), profile: "not_registered" }));
});
test("expanded simple profiles use researched basic rates", () => {
  for (const [profile, expectedDuty] of [
    ["shoes", 26000],
    ["shampoo", 10000],
    ["stroller", 10000],
    ["bedsheet", 20000],
    ["digital_camera", 0],
    ["headphones", 16000],
  ] as const) {
    const out = calculateTax(input(profile));
    assert.equal(out.taxes?.duty, expectedDuty, profile);
    assert.notEqual(out.totalTaxKrw, null);
  }
});
test("review-only profiles never become zero-tax successes, even below the value threshold", () => {
  for (const profile of [
    "catalog_248",
    "catalog_31",
    "catalog_23",
    "catalog_37",
    "catalog_44",
    "catalog_1",
    "catalog_181",
  ]) {
    const out = calculateTax({ ...input(profile), goods: "10" });
    assert.equal(out.status, "needs_review", profile);
    assert.equal(out.totalTaxKrw, null);
  }
  assert.equal(
    calculateTax({ ...input("digital_camera"), goods: "3000" }).status,
    "needs_review",
  );
});
test("new rules and brandy alcohol rules connect to the catalog", () => {
  for (const [title, profile] of [
    ["ノートパソコン", "laptop"],
    ["スニーカー", "shoes"],
    ["ヘッドホン", "headphones"],
    ["シャンプー", "shampoo"],
    ["香水", "catalog_31"],
    ["書籍 雑誌", "catalog_248"],
    ["ブランデー 700ml 40度", "brandy"],
  ]) {
    assert.ok(
      ruleClassify({ ...emptyProduct(), title }).candidates.some(
        (c) => c.profile === profile,
      ),
      title,
    );
  }
  const out = calculateTax(input("brandy"));
  assert.equal(out.taxes?.liquor, 187200);
  assert.equal(out.taxes?.education, 56160);
});

const calculations = JSON.parse(
  readFileSync("test/fixtures/customs/calculations.json", "utf8"),
);
for (const scenario of calculations.cases)
  test(`customs golden calculation: ${scenario.id}`, () => {
    if (scenario.expected.invalid) {
      assert.throws(() => calculateTax(scenario.input), ZodError);
      return;
    }
    const result = calculateTax(scenario.input);
    assert.equal(result.status, scenario.expected.status);
    assert.equal(result.totalTaxKrw, scenario.expected.totalTaxKrw);
    assert.equal(result.exemption, scenario.expected.exemption);
  });
test("customs datasets have unique identifiers, source provenance and separate synthetic cases", () => {
  assert.equal(dataset.samples.length, 60);
  assert.equal(new Set(dataset.samples.map((s: any) => s.id)).size, 60);
  const real = dataset.samples.filter(
    (s: any) => s.kind === "manufacturer_spec",
  );
  assert.equal(real.length, 11);
  for (const s of real) assert.ok(s.source.startsWith("https://"));
  assert.equal(calculations.cases.length, 30);
  assert.equal(new Set(calculations.cases.map((s: any) => s.id)).size, 30);
});
