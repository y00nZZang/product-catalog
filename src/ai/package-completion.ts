import { CatalogError } from "../domain";
import { measurementKeys, type Measurements } from "./package-estimate-schema";
export const PACKAGE_POLICY_VERSION = "complete-package-v1";
/** A successful proposal always has weight and three dimensions, but never promotes an unsupported
 * model estimate to source-backed evidence. No category rules or invented default sizes.
 * Provider/schema failures stay failures; they must not become a blank successful proposal.
 */
export function completePackageEstimates(
  raw: Measurements,
  accepted: Measurements,
) {
  const notes: string[] = [];
  for (const key of measurementKeys) {
    const range = raw[key].range;
    if (
      !range ||
      ![range.low, range.typical, range.high].every(
        (n) =>
          Number.isFinite(n) &&
          n > 0 &&
          n <= (key === "weightGrams" ? 30000 : 200),
      ) ||
      range.low > range.typical ||
      range.typical > range.high
    )
      throw new CatalogError(
        key === "weightGrams"
          ? "invalid_package_weight"
          : "invalid_dimension_estimate",
      );
    if (accepted[key].range) continue;
    const label = {
      weightGrams: "무게",
      lengthCm: "가로",
      widthCm: "세로",
      heightCm: "높이",
    }[key];
    const note = `포장 ${label}는 확인된 측정 근거가 부족한 모델 가정입니다. 실제 포장에 따라 범위를 벗어날 수 있으며 적용 전 확인이 필요합니다.`;
    accepted[key] = {
      range: { ...range },
      basis: "model_assumption",
      evidence: [],
      assumptions: [note, ...raw[key].assumptions.filter((s) => s.trim())],
    };
    notes.push(note);
  }
  return notes;
}
