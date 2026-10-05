/** Offline regression evaluation: manufacturer excerpts and synthetic scenarios remain separate. */
import { readFileSync, writeFileSync } from "node:fs";
import { ZodError } from "zod";
import { emptyProduct } from "../../src/domain";
import { ruleClassify } from "../../src/customs/classifier";
import { calculateTax } from "../../src/customs/calculator";
import { TAX_VERSION } from "../../src/customs/profiles";
const products = JSON.parse(
  readFileSync("test/fixtures/customs/products.json", "utf8"),
);
const calculations = JSON.parse(
  readFileSync("test/fixtures/customs/calculations.json", "utf8"),
);
const classification = products.samples.map(
  (s: {
    id: string;
    kind: string;
    title: string;
    description: string;
    expected: string[];
    unsupported?: boolean;
    ml?: number | null;
    abv?: number | null;
    bottles?: number | null;
    source?: string;
  }) => {
    const r = ruleClassify({
      ...emptyProduct(),
      title: s.title,
      description: s.description,
    });
    const candidates = r.candidates.map((c) => c.profile);
    const fields = [
      JSON.stringify(candidates) === JSON.stringify(s.expected),
      s.unsupported === undefined || s.unsupported === r.unsupported,
    ];
    for (const [input, output] of [
      ["ml", "mlPerBottle"],
      ["abv", "abv"],
      ["bottles", "bottles"],
    ] as const)
      if (input in s) fields.push(s[input] === r.alcohol[output]);
    return {
      id: s.id,
      kind: s.kind,
      source: s.source || null,
      passed: fields.every(Boolean),
      expected: s.expected,
      actual: candidates,
      route: r.unsupported
        ? "manual_review"
        : candidates.length === 1
          ? "rules"
          : "llm_or_review",
    };
  },
);
const arithmetic = calculations.cases.map(
  (s: {
    id: string;
    input: Parameters<typeof calculateTax>[0];
    expected: {
      invalid?: boolean;
      status?: string;
      totalTaxKrw?: number | null;
      exemption?: boolean | null;
    };
  }) => {
    try {
      const r = calculateTax(s.input);
      return {
        id: s.id,
        passed:
          !s.expected.invalid &&
          r.status === s.expected.status &&
          r.totalTaxKrw === s.expected.totalTaxKrw &&
          r.exemption === s.expected.exemption,
        status: r.status,
        totalTaxKrw: r.totalTaxKrw,
      };
    } catch (e) {
      return {
        id: s.id,
        passed: !!s.expected.invalid && e instanceof ZodError,
        status: "invalid_input",
      };
    }
  },
);
const report = {
  checkedAt: new Date().toISOString(),
  version: TAX_VERSION,
  kind: "offline_regression_not_hsk_accuracy",
  manufacturerSamples: classification.filter(
    (r: { kind: string }) => r.kind === "manufacturer_spec",
  ).length,
  syntheticSamples: classification.filter(
    (r: { kind: string }) => r.kind === "synthetic",
  ).length,
  classificationCases: classification.length,
  calculationCases: arithmetic.length,
  failures: [...classification, ...arithmetic].filter(
    (r: { passed: boolean }) => !r.passed,
  ),
  humanReviewed: 0,
  paidModelCalls: 0,
  classification,
  arithmetic,
};
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { ...report, classification: undefined, arithmetic: undefined },
    null,
    2,
  ),
);
if (report.failures.length) process.exitCode = 1;
