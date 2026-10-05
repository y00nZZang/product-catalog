import { packageSchema, type Identity } from "../domain";
import { manualPackageSpec } from "./schemas";
export interface ProposalEvidence {
  description: string;
  report: string;
}
/** Model agreement is not evidence: require a verbatim measurement from the supplied source.
 * User hints can describe assumptions, but are never promoted to seller-confirmed measurements. */
export function validatePackageProposal(
  value: unknown,
  material: ProposalEvidence,
  hint: string,
  urls: string[],
  id: Identity,
) {
  const data = manualPackageSpec.parse(value);
  const sources = data.sources.filter((s) => urls.includes(s));
  const evidenceText = [material.description, hint, material.report].join("\n");
  const evidenceQuotes = data.evidenceQuotes.filter(
    (q) =>
      q.length >= 3 &&
      evidenceText.includes(q) &&
      /\d[^\n]*(?:cm|mm|kg|g|センチ|グラム)/i.test(q),
  );
  const fromUserHint = evidenceQuotes.some((q) => hint.includes(q));
  const grounded =
    evidenceQuotes.length > 0 && (data.match === "matched" || fromUserHint);
  const bounded = (value: number | null, max: number) =>
    value !== null && Number.isFinite(value) && value > 0 && value <= max
      ? value
      : null;
  const partialPackage = {
    weightGrams: bounded(data.weightGrams, 30000),
    lengthCm: bounded(data.lengthCm, 200),
    widthCm: bounded(data.widthCm, 200),
    heightCm: bounded(data.heightCm, 200),
  };
  const parsed = packageSchema.safeParse({
    ...partialPackage,
    basis: "estimated",
    source: hint.trim()
      ? "사용자 추가 정보와 상품 설명"
      : sources.join("\n") || id.canonicalUrl,
    assumptions: [
      ...(hint.trim() ? ["사용자가 제공한 추가 정보에 기반"] : []),
      ...data.assumptions,
    ],
  });
  const pkg = grounded && parsed.success ? parsed.data : null;
  return {
    package: pkg,
    partialPackage: grounded ? partialPackage : null,
    sources: fromUserHint ? [] : sources,
    evidenceQuotes,
    inputBasis: fromUserHint ? "user_hint" : "source_research",
    assumptions: grounded
      ? [
          ...(fromUserHint
            ? [
                "사용자가 제공한 포장 조건을 정리한 값이며 판매처 실측을 확인한 것이 아닙니다.",
              ]
            : []),
          ...data.assumptions,
        ]
      : [],
    explanation: grounded
      ? data.explanation
      : "포장 크기·무게를 뒷받침하는 측정 근거를 확인하지 못했습니다. 원문 사양이나 판매자가 알려준 정보를 추가하거나 직접 입력해주세요.",
    reason: pkg ? "ai_proposal_ready" : "package_not_established",
    requiresReview: true,
  };
}
