import {
  completePackageEstimates,
  PACKAGE_POLICY_VERSION,
} from "./package-completion";
import { packageSchema, CatalogError } from "../domain";
import {
  estimateSchema,
  measurementKeys,
  type Measurements,
} from "./package-estimate-schema";
export interface EstimateSource {
  id: string;
  url: string;
  kind: "listing" | "search";
}
/** Keep each field's provenance. Invalid fields become unknown rather than poisoning useful partial results. */
export function validateEstimate(
  value: unknown,
  sources: EstimateSource[],
  hasImages: boolean,
  hint: string,
) {
  const data = estimateSchema.parse(value);
  const allowed = new Set([
    ...sources.map((s) => s.id),
    ...(hasImages ? ["visual"] : []),
    ...(hint.trim() ? ["user_hint"] : []),
  ]);
  const rejected: string[] = [];
  function clean(
    fields: Measurements,
    scope: string,
    productFields?: Measurements,
  ) {
    const productRefs = productFields
      ? measurementKeys
          .filter((k) => productFields[k].range)
          .map((k) => `product.${k}`)
      : [];
    const fieldAllowed = new Set([...allowed, ...productRefs]);
    return Object.fromEntries(
      measurementKeys.map((key) => {
        const f = fields[key],
          r = f.range,
          max = key === "weightGrams" ? 30000 : 200;
        const refs = [...new Set(f.evidence)].filter((ref) =>
          fieldAllowed.has(ref),
        );
        const validBasis =
          f.basis === "packing_allowance"
            ? scope === "package" &&
              refs.some(
                (ref) =>
                  productRefs.includes(ref) &&
                  (key === "weightGrams"
                    ? ref === "product.weightGrams"
                    : ref !== "product.weightGrams"),
              )
            : f.basis === "user_hint"
              ? refs.includes("user_hint")
              : f.basis === "similar_product"
                ? refs.some((ref) => ref.startsWith("search_"))
                : f.basis === "visual_estimate"
                  ? refs.includes("visual") &&
                    refs.some((ref) => ref !== "visual")
                  : f.basis === "exact_spec"
                    ? refs.some(
                        (ref) => ref === "listing" || ref.startsWith("search_"),
                      )
                    : false;
        const valid =
          r &&
          [r.low, r.typical, r.high].every(
            (n) => Number.isFinite(n) && n > 0 && n <= max,
          ) &&
          r.low <= r.typical &&
          r.typical <= r.high &&
          validBasis &&
          f.assumptions.some((text) => text.trim().length > 0);
        if (r && !valid)
          rejected.push(`${scope}.${key}: invalid_range_or_evidence`);
        return [
          key,
          valid
            ? { ...f, evidence: refs }
            : { ...f, range: null, basis: "unknown", evidence: [] },
        ];
      }),
    ) as Measurements;
  }
  const product = clean(data.product, "product"),
    packed = clean(data.package, "package", product);
  // A package cannot weigh less than its contents. Dimensions are not compared: flexible goods may fold.
  const pw = product.weightGrams.range,
    sw = data.package.weightGrams.range;
  if (
    pw &&
    sw &&
    (sw.low < pw.low || sw.typical < pw.typical || sw.high < pw.high)
  ) {
    throw new CatalogError("invalid_package_weight");
  }
  const scenarioNotes = completePackageEstimates(data.package, packed);
  const partialPackage = Object.fromEntries(
    measurementKeys.map((k) => [k, packed[k].range?.typical ?? null]),
  );
  const assumptions = [
    ...new Set([
      "AI 추정 범위이며 실측·통계적 신뢰구간이 아닙니다. 적용 전 확인해주세요.",
      ...scenarioNotes,
      ...data.assumptions,
      ...measurementKeys.flatMap((k) =>
        packed[k].range ? packed[k].assumptions : [],
      ),
    ]),
  ]
    .slice(0, 10)
    .map((s) => s.slice(0, 1000));
  const parsed = packageSchema.safeParse({
    ...partialPackage,
    basis: "estimated",
    source: sources
      .map((s) => s.url)
      .join("\n")
      .slice(0, 2000),
    assumptions,
  });
  return {
    package: parsed.success ? parsed.data : null,
    partialPackage,
    ranges: Object.fromEntries(
      measurementKeys.map((k) => [k, packed[k].range]),
    ),
    fieldEvidence: packed,
    productEstimates: product,
    sources: sources.map((s) => s.url),
    sourceDetails: sources,
    assumptions,
    missingInformation: data.missingInformation,
    explanation: data.explanation,
    validationWarnings: rejected,
    reason: parsed.success ? "ai_proposal_ready" : "package_not_established",
    requiresReview: true as const,
    packagePolicyVersion: PACKAGE_POLICY_VERSION,
    scenarioNotes,
    inputBasis: "multimodal_estimate",
  };
}
