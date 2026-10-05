import { refreshAutomaticCustoms } from "./customs.js";
import { state } from "../state.js";
import { $ } from "../dom.js";
import { api } from "../api.js";
import { poll } from "../polling.js";
import { labels, explain } from "../labels.js";
import { message } from "../status.js";
import { renderResult } from "../presenters/catalog.js";
import { renderQuotes } from "../views/quotes.js";
import { renderRun } from "../views/run.js";

// AI completion only proposes values. Applying a proposal is a separate user action.
export function bindPackageControls() {
  $("ai-package").onclick = async () => {
    if (!state.current?.observation) return;
    const listingId = state.current.listing.id;
    const generationToken = ++state.generation;
    state.packageBusy = true;
    $("ai-package").disabled = true;
    message(
      "상품 이미지·설명과 웹 검색 자료를 분석하고 있습니다…",
      false,
      "ai-status",
    );
    try {
      const r = await api(`listings/${listingId}/package-analysis`, {
        hint: $("ai-hint").value,
      });
      const done = await poll(r.runId, generationToken, (analysis) => {
        message(
          labels[analysis.work.status] || analysis.work.status,
          false,
          "ai-status",
        );
      });
      if (
        done &&
        generationToken === state.generation &&
        state.current?.listing.id === listingId
      ) {
        if (done.work.status === "succeeded") {
          const updated = await api("listings/" + listingId);
          renderResult(updated);
          refreshAutomaticCustoms();
          message(
            "추정이 끝났습니다. 결과와 근거를 확인해주세요.",
            false,
            "ai-status",
          );
        } else message(explain(done.work.error_type), true, "ai-status");
      }
    } catch (e) {
      if (generationToken === state.generation)
        message(explain(e.message), true, "ai-status");
    } finally {
      state.packageBusy = false;
      $("ai-package").disabled = !state.llmEnabled || state.collecting;
    }
  };
  $("apply-proposal").onclick = () => {
    const values = state.proposal?.package || state.proposal?.partialPackage;
    if (!values) return;
    for (const k of ["weightGrams", "lengthCm", "widthCm", "heightCm"])
      if (typeof values[k] === "number" && values[k] > 0)
        $("package").elements[k].value = values[k];
    $("package").elements.basis.value = "user_assumption";
    state.draftSource = (
      "자동 추정 · " +
      (state.proposal.package?.source ||
        state.proposal.sources?.join(" ") ||
        "상품 설명")
    ).slice(0, 2000);
    state.draftAssumptions = (state.proposal.assumptions || [])
      .slice(0, 10)
      .map((x) => x.slice(0, 1000));
    $("flow-package").textContent = "추정값 입력됨";
    $("flow-quote").textContent = "재계산 필요";
    message(
      "수정 폼에 추정값을 채웠습니다. 변경할 조건을 확인한 뒤 배송비를 다시 계산하세요.",
      false,
      "ai-status",
    );
  };
  $("package").oninput = () => {
    $("flow-package").textContent = "입력 중";
    $("flow-quote").textContent = "재계산 필요";
  };
  $("package").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.current) return;
    const target = state.current.listing.id;
    const generationToken = ++state.generation;
    const button = e.submitter;
    button.disabled = true;
    try {
      const form = new FormData(e.target);
      const packageInput = {
        basis: form.get("basis"),
        source:
          form.get("basis") === "user_measured"
            ? "사용자 직접 측정"
            : state.draftSource,
        assumptions:
          form.get("basis") === "user_measured" ? [] : state.draftAssumptions,
      };
      for (const k of ["weightGrams", "lengthCm", "widthCm", "heightCm"])
        packageInput[k] = Number(form.get(k));
      const quoteResult = await api(`listings/${target}/quotes`, packageInput);
      if (generationToken !== state.generation) return;
      const updated = await api("listings/" + target);
      if (generationToken !== state.generation) return;
      renderResult(updated);
      renderQuotes(quoteResult);
      refreshAutomaticCustoms();
      renderRun(await api("analyses/" + quoteResult.runId));
      $("flow-quote").textContent = "참고 견적 확인";
      $("flow-package").textContent = "입력 완료";
      message("입력한 포장 조건으로 견적을 계산했습니다.");
    } catch (e) {
      message(explain(e.message), true);
    } finally {
      button.disabled = false;
    }
  };
}
