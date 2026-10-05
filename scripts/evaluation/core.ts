import { readFileSync } from "node:fs";
import { identify } from "../../src/domain";
import { parseHtml } from "../../src/merchants/html";
export const reviewFields = [
  "title",
  "price",
  "currency",
  "availability",
  "condition",
  "domesticShippingAmount",
];
export function evaluateManifest(manifest: any) {
  const counts: Record<string, any> = {};
  const mismatches: any[] = [];
  let captured = 0,
    parsed = 0,
    agentReviewed = 0,
    humanReviewed = 0;
  const rows = [];
  for (const sample of manifest.samples) {
    const platform = identify(sample.url).platform;
    let prediction: any = {};
    if (sample.htmlPath) {
      captured++;
      try {
        const p = parseHtml(
          readFileSync(sample.htmlPath, "utf8"),
          identify(sample.url),
        );
        prediction = {
          ...p,
          domesticShippingAmount: p.domesticShipping.amount,
        };
        parsed++;
      } catch {}
    }
    if (sample.reviewerType === "human" && sample.reviewStatus === "approved")
      humanReviewed++;
    if (sample.reviewerType === "agent" && sample.reviewStatus === "approved")
      agentReviewed++;
    const row: any = {
      url: sample.url,
      platform,
      reviewStatus: sample.reviewStatus || "legacy",
      captureError: sample.captureError,
      fields: {},
    };
    for (const field of reviewFields) {
      const k = platform + ":" + field;
      const c = (counts[k] ??= {
        attempted: 0,
        scored: 0,
        correct: 0,
        wrong: 0,
        missing: 0,
        unscored: 0,
      });
      c.attempted++;
      if (
        !(field in (sample.expected || {})) ||
        sample.reviewStatus === "pending" ||
        sample.reviewStatus === "capture_failed"
      ) {
        c.unscored++;
        continue;
      }
      c.scored++;
      const value = prediction[field],
        expected = sample.expected[field];
      const match = value === expected;
      const status = match
        ? "correct"
        : value == null || value === "unknown"
          ? "missing"
          : "wrong";
      c[status]++;
      row.fields[field] = { expected, actual: value ?? null, status };
      if (!match)
        mismatches.push({
          url: sample.url,
          field,
          expected,
          actual: value ?? null,
          status,
        });
    }
    rows.push(row);
  }
  for (const c of Object.values(counts)) {
    c.accuracyAmongScored = c.scored ? c.correct / c.scored : null;
    c.coverage = c.attempted ? c.scored / c.attempted : 0;
  }
  return {
    datasetKind: manifest.kind,
    samples: manifest.samples.length,
    uniqueUrls: new Set(manifest.samples.map((s: any) => s.url)).size,
    captured,
    parsed,
    agentReviewed,
    humanReviewed,
    counts,
    mismatches,
    rows,
  };
}
