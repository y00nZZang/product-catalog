import { packageSummary } from "../views/workflow.js";
import { showCustoms } from "../controllers/customs.js";
import { state } from "../state.js";
import { $, node } from "../dom.js";
import { labels, methods, explain } from "../labels.js";
import { money } from "../format.js";
import { renderQuotes } from "../views/quotes.js";
import { renderProposal } from "../views/proposal.js";

// A new observation can initialize a form. Polling the same observation must preserve the user's in-progress edits.
export function renderResult(result, preview = false) {
  if (!result) return;
  if (!preview) state.current = result;
  const observation = result.observation;
  $("result").hidden = !observation;
  if (!observation) return;
  const product = observation.data;
  const changed = state.displayKey !== observation.id;
  if (!preview) state.displayKey = observation.id;
  $("title").textContent = product.translatedTitle || product.title;
  $("original-title").hidden = !product.translatedTitle;
  $("original-title").textContent = product.translatedTitle
    ? product.title
    : "";
  $("price").textContent = product.priceRange
    ? `${money(product.priceRange.min, product.currency)} ~ ${money(product.priceRange.max, product.currency)}`
    : money(product.price, product.currency);
  $("availability").textContent =
    product.availability === "sold_out"
      ? "판매 종료 · 아래 비용은 구매 가능한 견적이 아닌 참고 추정입니다."
      : `판매 상태: ${labels[product.availability] || "미확인"}`;
  $("converted-price").textContent = product.conversion
    ? `약 ${money(product.conversion.amount, "KRW")} · 환율 기준 ${product.conversion.date}`
    : "";
  $("observed").textContent =
    `관측 ${new Date(observation.observed_at).toLocaleString()}${observation.stale ? " · 갱신 필요" : ""}`;
  $("source").href = result.listing.canonical_url;
  $("source-kind").textContent =
    methods[product.sourceType] ||
    (product.apiItemCode ? "이치바 API" : "웹페이지");
  const img = product.images?.find((s) => s.startsWith("https://"));
  $("image").hidden = !img;
  if (img) $("image").src = img;
  $("facts").replaceChildren();
  for (const [k, v] of [
    [
      "판매처",
      result.listing.platform === "rakuten"
        ? result.listing.external_id.startsWith("books:")
          ? "라쿠텐 북스"
          : "라쿠텐 이치바"
        : "메루카리",
    ],
    ["판매자", product.seller],
    ["판매 상태", labels[product.availability]],
    ["상품 상태", product.condition],
    [
      "현지 배송비",
      money(product.domesticShipping.amount, product.domesticShipping.currency),
    ],
    ["배송 조건", product.domesticShipping.condition],
  ])
    $("facts").append(node("dt", k), node("dd", v || "미확인"));
  $("description").textContent =
    product.description || "원문 설명을 확인하지 못했습니다.";
  const notes = [
    ...(product.warnings || []).map(explain),
    observation.stale
      ? "관측 정보가 오래되었습니다. 새로고침으로 갱신해주세요."
      : "",
    result.latestCollection?.status === "failed"
      ? `최근 갱신 실패: ${explain(result.latestCollection.error_type)}`
      : "",
  ].filter(Boolean);
  $("warnings").textContent = notes.join("\n");
  $("warnings").hidden = !notes.length;
  if (preview) {
    $("summary-package").textContent = "이미지·설명으로 추정 중";
    return;
  }
  packageSummary(result);
  const logistics = result.logistics?.data;
  $("package-state").textContent =
    logistics?.requiresReview || logistics?.origin === "manual_ai"
      ? "자동 추정한 포장 조건입니다. 근거를 확인하거나 필요한 경우에만 수정하세요."
      : logistics?.package
        ? `저장된 포장 조건 · ${logistics.package.basis === "user_measured" ? "직접 측정" : "가정·추정"}`
        : explain(logistics?.reason || "awaiting_package_input");
  state.proposal =
    logistics?.requiresReview || logistics?.origin === "manual_ai"
      ? logistics
      : null;
  renderProposal(state.proposal);
  if (changed) {
    showCustoms(result);
    $("package").reset();
    $("ai-hint").value = "";
    state.draftSource = "사용자 입력";
    state.draftAssumptions = [];
    const saved = logistics?.requiresReview
      ? !result.quote?.stale
        ? result.quote?.data?.quotes?.[0]?.package
        : null
      : logistics?.package;
    if (saved) {
      for (const k of ["weightGrams", "lengthCm", "widthCm", "heightCm"])
        $("package").elements[k].value = saved[k] || "";
      if (saved.basis === "user_measured")
        $("package").elements.basis.value = "user_measured";
      state.draftSource = saved.source || "사용자 입력";
      state.draftAssumptions = saved.assumptions || [];
    }
  }
  renderQuotes(result.quote?.data);
  if (result.quote?.stale)
    $("quotes").prepend(
      node(
        "p",
        "이전 관측 정보로 계산한 견적입니다. 다시 계산해주세요.",
        "notice",
      ),
    );
  $("flow-product").textContent = observation.stale ? "갱신 필요" : "확인 완료";
  $("flow-package").textContent = logistics?.requiresReview
    ? logistics.package ||
      Object.values(logistics.partialPackage || {}).some(
        (x) => typeof x === "number",
      )
      ? "추정 결과 확인"
      : "추가 정보 필요"
    : logistics?.package
      ? "조건 확인"
      : "입력 필요";
  $("flow-quote").textContent =
    result.quote && !result.quote.stale ? "참고 견적 확인" : "계산 대기";
  $("ai-package").disabled =
    !state.llmEnabled || state.collecting || state.packageBusy;
}
