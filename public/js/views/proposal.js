import { $, node, links } from "../dom.js";
import { explain } from "../labels.js";
export function renderProposal(proposal) {
  $("ai-proposal").hidden = !proposal;
  if (!proposal) return;
  $("ai-explanation").textContent =
    proposal.explanation || explain(proposal.reason);
  $("ai-values").replaceChildren();
  const values = proposal.package || proposal.partialPackage || {};
  const basisLabels = {
    exact_spec: "동일 상품 사양 기반",
    similar_product: "유사 상품 기반",
    packing_allowance: "제품 추정값 + 포장 여유",
    visual_estimate: "이미지·참고 근거 추정",
    user_hint: "사용자 가정",
    model_assumption: "모델 가정 · 근거 미확인",
    unknown: "근거 부족",
  };
  for (const [k, label, unit] of [
    ["weightGrams", "포장 무게", "g"],
    ["lengthCm", "가로", "cm"],
    ["widthCm", "세로", "cm"],
    ["heightCm", "높이", "cm"],
  ]) {
    const range = proposal.ranges?.[k];
    const basis = proposal.fieldEvidence?.[k]?.basis;
    $("ai-values").append(
      node("dt", label),
      node(
        "dd",
        values[k] == null
          ? "미확인"
          : range
            ? `${range.low}–${range.high} ${unit} · 대표 ${range.typical} ${unit} · ${basisLabels[basis] || basis}`
            : `${values[k]} ${unit}`,
      ),
    );
  }
  $("ai-assumptions").replaceChildren();
  for (const text of proposal.assumptions ||
    proposal.package?.assumptions ||
    [])
    $("ai-assumptions").append(node("li", text));
  for (const question of proposal.missingInformation || [])
    $("ai-assumptions").append(node("li", `추가 확인: ${question}`));
  for (const warning of [
    ...(proposal.imageWarnings || []),
    ...(proposal.searchWarnings || []),
  ])
    $("ai-assumptions").append(node("li", `자료 제한: ${explain(warning)}`));
  if (proposal.contract)
    $("ai-assumptions").append(
      node(
        "li",
        `이미지 ${proposal.imageCount || 0}장 분석 · 범위는 가정별 시나리오이며 보장값이 아닙니다.`,
      ),
    );
  const fieldLabels = {
    weightGrams: "무게",
    lengthCm: "가로",
    widthCm: "세로",
    heightCm: "높이",
  };
  const evidenceLabel = (ref) =>
    ref.startsWith("product.")
      ? `제품 ${fieldLabels[ref.slice(8)] || ref}`
      : ref === "visual"
        ? "상품 이미지"
        : ref === "user_hint"
          ? "사용자 단서"
          : `근거 ${(proposal.sourceDetails || []).findIndex((s) => s.id === ref) + 1}`;
  for (const key of Object.keys(fieldLabels)) {
    const productField = proposal.productEstimates?.[key];
    if (productField?.range)
      $("ai-assumptions").append(
        node(
          "li",
          `제품 ${fieldLabels[key]}: ${productField.range.low}–${productField.range.high} ${key === "weightGrams" ? "g" : "cm"} · ${basisLabels[productField.basis]} · ${(productField.evidence || []).map(evidenceLabel).join(", ")} · ${(productField.assumptions || []).join(" / ")}`,
        ),
      );
    const field = proposal.fieldEvidence?.[key];
    if (field?.range)
      $("ai-assumptions").append(
        node(
          "li",
          `포장 ${fieldLabels[key]}: ${(field.evidence || []).map(evidenceLabel).join(", ")} · ${(field.assumptions || []).join(" / ")}`,
        ),
      );
  }
  $("ai-scenarios").replaceChildren();
  if (
    !proposal.package &&
    proposal.ranges?.lengthCm &&
    proposal.ranges?.widthCm &&
    proposal.ranges?.heightCm
  )
    $("ai-scenarios").append(
      node(
        "p",
        "세 변 추정 완료 · 배송비 계산에는 포장 무게를 확인해주세요.",
        "notice",
      ),
    );
  // Scenario previews are not persisted/approved quotes; never turn an unavailable upper tier into zero.
  for (const note of proposal.scenarioNotes || [])
    $("ai-scenarios").append(node("p", note, "notice"));
  const scenarios = proposal.quoteScenarios || [];
  if (scenarios.length) {
    for (const quote of scenarios[0].quotes || []) {
      const results = scenarios.map((s) =>
        s.quotes.find((q) => q.provider === quote.provider),
      );
      const amounts = results.map((q) => q?.knownSubtotal);
      const complete = amounts.every((n) => typeof n === "number");
      $("ai-scenarios").append(
        node(
          "p",
          complete
            ? `${quote.provider} 확인 비용 시나리오: ${Math.min(...amounts)}–${Math.max(...amounts)} ${quote.currency} · 미확인 비용 제외 · 추정 조건 기준`
            : `${quote.provider}: 일부 시나리오는 운임·규격을 산정할 수 없습니다.`,
        ),
      );
    }
  }
  links($("ai-sources"), proposal.sources);
  $("apply-proposal").disabled = !Object.values(values).some(
    (v) => typeof v === "number" && v > 0,
  );
}
