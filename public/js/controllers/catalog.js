import { loadCurrentFx } from "./exchange-rate.js";
import { clearRunHistory } from "../views/run.js";
import { cancelCustoms } from "./customs.js";
import { resetWorkflow, collectionProgress, stage } from "../views/workflow.js";
import { renderListings, renderListError } from "../views/list.js";
import { state } from "../state.js";
import { $ } from "../dom.js";
import { api } from "../api.js";
import { poll } from "../polling.js";
import { labels, explain } from "../labels.js";
import { message } from "../status.js";
import { renderResult } from "../presenters/catalog.js";

export async function refreshList() {
  try {
    const rows = await api("listings");
    renderListings(rows, selectListing);
  } catch {
    renderListError();
  }
}
async function selectListing(item) {
  const token = ++state.generation;
  state.collecting = false;
  $("analyze").disabled = false;
  $("refresh-product").disabled = false;
  cancelCustoms();
  resetWorkflow();
  clearRunHistory();
  state.displayKey = null;
  try {
    const result = await api("listings/" + item.id);
    if (token !== state.generation) return;
    renderResult(result);
    $("timing").hidden = true;
    $("url").value = item.canonical_url;
    message("저장된 관측 정보입니다. 최신 정보가 필요하면 새로고침해주세요.");
    message("", false, "ai-status");
  } catch (error) {
    if (token !== state.generation) return;
    stage(0, "error");
    message(explain(error.message), true);
  }
}

export async function analyze(force = false) {
  cancelCustoms();
  resetWorkflow();
  clearRunHistory();
  state.displayKey = null;
  state.collecting = true;
  $("ai-package").disabled = true;
  const generationToken = ++state.generation;
  $("analyze").disabled = true;
  $("refresh-product").disabled = true;
  message("상품 정보를 확인하고 있습니다…");
  try {
    const requested = await api("analyses", {
      url: $("url").value,
      refresh: force,
    });
    const done = await poll(requested.runId, generationToken, (analysis) => {
      const active = ["queued", "running", "waiting"].includes(
        analysis.work.status,
      );
      if (!active) renderResult(analysis.result);
      else if (
        analysis.work.preview &&
        analysis.work.preview.attempt === analysis.work.attempt &&
        analysis.result?.listing
      ) {
        renderResult(
          {
            listing: analysis.result.listing,
            observation: {
              id: null,
              data: analysis.work.preview.product,
              observed_at: analysis.work.preview.observedAt,
            },
          },
          true,
        );
      }
      collectionProgress(analysis);
      message(
        (analysis.work.status === "succeeded"
          ? "상품·포장 확인을 마쳤습니다. 관세·비용 결과를 확인합니다."
          : labels[analysis.work.status] || analysis.work.status) +
          (analysis.work.error_type
            ? " · " + explain(analysis.work.error_type)
            : ""),
        analysis.work.status === "failed",
      );
    });
    if (done) await refreshList();
  } catch (e) {
    if (generationToken !== state.generation) return;
    stage(0, "error");
    message(explain(e.message), true);
  } finally {
    if (generationToken !== state.generation) return;
    state.collecting = false;
    $("analyze").disabled = false;
    $("refresh-product").disabled = false;
    $("ai-package").disabled = !state.llmEnabled || state.packageBusy;
  }
}

export async function loadHealth() {
  try {
    const h = await api("health");
    state.llmEnabled = h.llmEnabled;
    $("service-state").textContent = state.llmEnabled
      ? "상품 → 배송 → 관세 자동 추정"
      : "자동 추정 연결 확인 필요";
    $("ai-package").disabled =
      !state.llmEnabled || state.collecting || state.packageBusy;
  } catch {
    state.llmEnabled = false;
  }
}

export function bindCatalogControls() {
  $("lookup").onsubmit = (e) => {
    e.preventDefault();
    analyze();
  };
  $("refresh-product").onclick = () => {
    if (state.current) {
      $("url").value = state.current.listing.canonical_url;
      analyze(true);
    }
  };
  $("refresh-list").onclick = () => {
    loadHealth();
    loadCurrentFx();
    refreshList();
  };
}
