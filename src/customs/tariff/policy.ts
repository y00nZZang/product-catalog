import type { ResolvedTariff, PublishedRate } from "./types";
// Ordinary finished-goods VAT scenario only. Lookup coverage is broader than calculation approval.
const ordinaryChapters = new Set([
  39, 40, 42, 48, 61, 62, 63, 64, 65, 66, 69, 70, 73, 74, 76, 82, 83, 84, 85,
  94, 95, 96,
]);
export function tariffReviewReason(
  rate: PublishedRate,
  internalTaxStatus: ResolvedTariff["internalTaxStatus"],
  alternatives: PublishedRate[] = [],
) {
  if (
    rate.type !== "A" ||
    rate.rate === null ||
    rate.rate > 1000 ||
    rate.unitAmount !== null
  )
    return "종가 기본세율을 단독으로 적용할 수 없습니다. 단위당·선택 세율 확인이 필요합니다.";
  if (
    !ordinaryChapters.has(Number(rate.hsk.slice(0, 2))) ||
    rate.hsk.startsWith("9619")
  )
    return "부가세 면제·추가 세목·품목별 조건 검토가 필요한 범위입니다.";
  if (hasPriorityDuty(rate, alternatives))
    return "덤핑·긴급·조정 등 우선/추가 세율의 적용조건 검토가 필요합니다.";
  if (internalTaxStatus !== "none_listed")
    return "공개 내국세 항목의 추가 세목·조건 확인이 필요합니다.";
  return null;
}
export const publicValueThreshold = (hsk: string) =>
  [42, 94].includes(Number(hsk.slice(0, 2))) ? 2_000_000 : null;

export function hasPriorityDuty(
  rate: PublishedRate,
  alternatives: PublishedRate[],
) {
  return alternatives.some(
    (r) =>
      /^[IMJKTL]/.test(r.type) ||
      (r.type !== "A" &&
        r.rate !== null &&
        rate.rate !== null &&
        r.rate > rate.rate),
  );
}
