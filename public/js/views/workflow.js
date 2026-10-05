import { $ } from "../dom.js";
const names = {
  waiting: "대기",
  running: "진행 중",
  done: "완료",
  partial: "일부 확인 필요",
  error: "실패",
  cached: "저장 결과",
};
export function stage(index, status) {
  $("journey").hidden = false;
  $("stage-" + index).dataset.state = status;
  $("stage-status-" + index).textContent = names[status];
}
export function resetWorkflow() {
  for (let i = 0; i < 3; i++) stage(i, "waiting");
  stage(0, "running");
  $("result").hidden = true;
  $("timing").hidden = true;
  $("journey-note").textContent = "서버 작업 상태를 확인하고 있습니다.";
  $("summary-tax").textContent = "추정 대기";
  $("summary-category").textContent = "";
  $("summary-tax-note").textContent = "기본세율 가정 · 품목 확인 필요";
  $("summary-shipping").textContent = "배송비 추정 대기";
  $("summary-total").textContent = "추정 대기";
  $("summary-total-note").textContent =
    "미확인 비용은 0원으로 처리하지 않습니다.";
}
export function collectionProgress(analysis) {
  const w = analysis.work,
    active = ["queued", "running", "waiting"].includes(w.status);
  if (active) {
    const packaging = Boolean(w.preview && w.preview.attempt === w.attempt);
    stage(0, packaging ? "done" : "running");
    stage(1, packaging ? "running" : "waiting");
    stage(2, "waiting");
    $("journey-note").textContent =
      w.status === "queued"
        ? "작업 대기 중 · 사이트 요청 간격을 준수합니다."
        : packaging
          ? "상품을 확인했습니다. 이미지·설명·검색으로 포장 정보를 추정합니다."
          : "판매처에서 상품 정보를 확인하고 있습니다.";
  } else if (w.status !== "succeeded") {
    stage(w.preview ? 1 : 0, "error");
    $("journey-note").textContent =
      "분석을 완료하지 못했습니다. 이전 관측 결과가 있으면 갱신 실패 표시와 함께 유지합니다.";
  } else if (analysis.request.cache_hit) stage(0, "cached");
}
export function packageSummary(result) {
  const p = result.logistics?.data?.package;
  const complete =
    p &&
    [p.weightGrams, p.lengthCm, p.widthCm, p.heightCm].every(
      (x) => Number.isFinite(x) && x > 0,
    );
  $("summary-package").textContent = complete
    ? `${p.weightGrams.toLocaleString()} g · ${p.lengthCm} × ${p.widthCm} × ${p.heightCm} cm`
    : "포장 정보 추가 확인 필요";
  stage(0, result.observation.stale ? "partial" : "done");
  stage(1, complete ? "done" : "partial");
}
const range = (r) =>
  r
    ? r.min === r.max
      ? `${Math.round(r.min).toLocaleString()}원`
      : `${Math.round(r.min).toLocaleString()} ~ ${Math.round(r.max).toLocaleString()}원`
    : "추정 불가 · 정보 부족";
export function customsSummary(result) {
  const active = ["queued", "running"].includes(result.autoRun?.status);
  const d = result.automaticFresh ? result.automatic?.data : null;
  stage(
    1,
    active
      ? "running"
      : d?.shippingRangeKrw &&
          !(d.scenarios || []).some((s) => s.missingCosts?.length)
        ? "done"
        : "partial",
  );
  stage(
    2,
    active
      ? "running"
      : d
        ? d.status === "estimated"
          ? "done"
          : "partial"
        : result.autoRun?.status === "failed"
          ? "error"
          : "partial",
  );
  $("summary-tax").textContent = d
    ? d.taxRangeKrw
      ? range(d.taxRangeKrw)
      : d.tariffLookup?.candidates?.length
        ? "계산 조건 확인 필요"
        : d.hsClassification?.candidates?.length
          ? d.hsClassification.status === "candidate"
            ? "세율 확인 필요"
            : "세부 분류 확인 필요"
          : "분류·입력 확인 필요"
    : active
      ? "관세·환율 확인 중"
      : "추가 확인 필요";
  $("summary-shipping").textContent = d
    ? `국제배송·취급 ${range(d.shippingRangeKrw)}`
    : "배송비 계산 대기";
  $("summary-category").textContent = d
    ? [...new Set((d.scenarios || []).map((s) => s.label))].join(" · ")
    : "";
  if (d?.hsClassification?.candidates?.length) {
    $("summary-category").textContent = d.hsClassification.candidates
      .map((c) => `${c.label} · HS ${c.code} 후보`)
      .join(" / ");
  }
  $("summary-tax-note").textContent =
    d && !d.taxRangeKrw
      ? d.missingInformation?.[0] ||
        d.scenarios?.find((s) => s.reason)?.reason ||
        d.hsClassification?.missingInformation?.[0] ||
        "세율과 세부 조건을 확인해주세요."
      : d?.publicTariffApplied
        ? "공개 HSK 기본세율(A) · 부가세 10% 가정"
        : "기본세율 가정 · 품목 확인 필요";
  $("summary-total").textContent = d
    ? range(d.knownTotalRangeKrw)
    : active
      ? "계산 중"
      : "추가 확인 필요";
  $("summary-total-note").textContent = d?.rangeComplete
    ? "포장·기본세율 가정에 따른 예상치입니다."
    : "미확인 배송비·수수료 등이 있어 확정 총액이 아닙니다. 아래 계산 근거를 확인하세요.";
  $("journey-note").textContent = active
    ? "관세 품목·공식 환율·배송 시나리오를 확인하고 있습니다."
    : d?.status === "estimated"
      ? "자동 분석이 끝났습니다. 추정 조건과 실제 청구 금액은 다를 수 있습니다."
      : "확인 가능한 결과를 표시했습니다. 부족한 정보는 아래에서 확인·수정할 수 있습니다.";
}
