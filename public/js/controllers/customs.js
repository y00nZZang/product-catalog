import { renderRun } from "../views/run.js";
import { customsSummary, stage } from "../views/workflow.js";
import { renderAutomaticCustoms } from "../views/customs-auto.js";
import { $, node, links } from "../dom.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { poll } from "../polling.js";
import { explain } from "../labels.js";
let current = null,
  classification = null,
  metadata = null,
  revision = 0,
  automaticTimer = null,
  lastClassificationId = undefined,
  automaticPolls = 0;
function message(s) {
  $("tax-status").textContent = s;
}
function renderEstimate(data, stale = false) {
  $("tax-result").replaceChildren();
  if (!data) return;
  if (stale)
    $("tax-result").append(
      node(
        "p",
        "이전 상품 관측 또는 세율표 기준 세액입니다. 재분류·계산이 필요합니다.",
        "notice",
      ),
    );
  if (data.taxes) {
    $("tax-result").append(
      node(
        "h3",
        `예상 세금 ${data.totalTaxKrw.toLocaleString()}원 · 기본세율 가정`,
      ),
    );
    const dl = node("dl", null, "facts");
    for (const [key, label] of [
      ["duty", "관세"],
      ["liquor", "주세"],
      ["education", "교육세"],
      ["vat", "부가세"],
    ])
      dl.append(
        node("dt", label),
        node("dd", `${data.taxes[key].toLocaleString()}원`),
      );
    $("tax-result").append(
      dl,
      node(
        "p",
        `면세판정 금액 ${data.thresholdAmountKrw.toLocaleString()}원 · 과세가격 ${data.taxableValueKrw.toLocaleString()}원 · 관세/부가세 소액면세 ${data.exemption ? "적용" : "미적용"}`,
      ),
    );
  } else
    $("tax-result").append(
      node("p", data.reason || "추가 확인 필요", "notice"),
    );
  if (data.metadata)
    $("tax-result").append(
      node(
        "p",
        `세율 확인일 ${data.metadata.checkedAt} · 계산 기준일 ${data.fx?.referenceDate || data.input?.fx?.referenceDate || "미확인"}`,
        "hint",
      ),
    );
  for (const w of data.warnings || [])
    $("tax-result").append(node("p", w, "hint"));
  const sources = node("div", null, "source-links");
  links(sources, data.metadata?.sources);
  $("tax-result").append(sources);
}
async function refresh(token = revision, allowAutomatic = true) {
  if (!current) return;
  const item = current;
  const result = await api(`listings/${item.listing.id}/customs`);
  if (token !== revision) return;
  metadata ||= await api("listings/tax-metadata");
  if (token !== revision) return;
  $("tax-coverage").textContent = metadata.coverage
    ? `정적 계산 프로필 ${metadata.coverage.calculableProfiles}종 · 추가 검토 ${metadata.coverage.reviewProfiles}종${metadata.publicHsk ? " · 공개 HSK 세율 개별 조회 연결" : ""}. 전체 품목의 확정 세율을 보장하는 표는 아닙니다.`
    : "";
  renderAutomaticCustoms(result.automatic, result.automaticFresh);
  customsSummary(result);
  if (result.autoRun?.id) {
    try {
      const trace = await api("analyses/" + result.autoRun.id);
      if (token !== revision) return;
      renderRun(trace);
    } catch {
      /* Summary polling can continue if optional timing is unavailable. */
    }
  }
  if (token !== revision) return;
  const active =
    result.autoRun && ["queued", "running"].includes(result.autoRun.status);
  $("tax-auto-status").textContent = active
    ? "관세·환율·배송비 자동 추정 중…"
    : result.automaticFresh
      ? "현재 자료 기준 자동 추정 완료"
      : "";
  if (result.automatic?.data.fx) {
    const f = result.automatic.data.fx;
    for (const k of [
      "jpyToKrw",
      "usdToKrw",
      "validFrom",
      "validTo",
      "referenceDate",
    ])
      if (!$("tax-form").elements[k].value)
        $("tax-form").elements[k].value = f[k];
  }
  const c = result.classification;
  classification =
    c?.observation_id === item.observation.id &&
    c?.data.version === metadata.version
      ? c
      : null;
  if (lastClassificationId !== (classification?.id || null)) {
    lastClassificationId = classification?.id || null;
    const select = $("tax-profile");
    select.replaceChildren();
    const blank = node("option", "품목 후보를 확인하고 선택");
    blank.value = "";
    select.append(blank);
    for (const candidate of classification?.data.candidates || []) {
      const o = node(
        "option",
        (metadata.profiles[candidate.profile]?.label || candidate.profile) +
          (metadata.profiles[candidate.profile]?.calculationStatus ===
          "needs_review"
            ? " · 추가 검토"
            : ""),
      );
      o.value = candidate.profile;
      select.append(o);
    }
    $("tax-confirm").checked = false;
    $("tax-rate-preview").textContent =
      "품목 선택 후 적용할 기본세율이 표시됩니다.";
    $("tax-classification").replaceChildren();
    if (classification) {
      $("tax-classification").append(
        node("p", classification.data.explanation),
      );
      for (const c of classification.data.candidates)
        $("tax-classification").append(
          node(
            "p",
            `${metadata.profiles[c.profile].label}: ${c.rationale} · 근거: ${c.evidenceQuotes.join(" / ")}`,
            "hint",
          ),
        );
      for (const field of ["bottles", "mlPerBottle", "abv"])
        $("tax-form").elements[field].value =
          classification.data.alcohol?.[field] ?? "";
      if (!classification.data.candidates.length)
        message(
          "지원 품목을 확인하지 못했습니다. 용도·재질·내용물 정보를 추가해주세요.",
        );
    } else
      message(
        "먼저 품목을 추론해주세요. 분류 결과는 사용자 검토가 필요합니다.",
      );
  }
  renderEstimate(
    result.estimate?.data,
    result.estimate?.observation_id !== item.observation.id ||
      result.estimate?.data.metadata?.version !== metadata.version,
  );
  if (active && ++automaticPolls > 150) {
    $("tax-auto-status").textContent =
      "자동 추정 작업이 지연되고 있습니다. 잠시 후 다시 확인해주세요.";
    return;
  }
  if (active) {
    clearTimeout(automaticTimer);
    automaticTimer = setTimeout(() => {
      if (token === revision)
        refresh(token, false).catch((e) => {
          $("tax-auto-status").textContent = explain(e.message);
        });
    }, 1200);
  } else if (allowAutomatic && !result.automaticFresh) {
    await requestAutomatic(token);
  }
}
async function requestAutomatic(token = revision) {
  if (!current) return;
  const id = current.listing.id;
  automaticPolls = 0;
  const r = await api(`listings/${id}/tax-analysis`, { automatic: true });
  if (token !== revision) return;
  if (r.status && !["queued", "running"].includes(r.status)) {
    await refresh(token, false);
    if (token === revision && r.status !== "succeeded")
      $("tax-auto-status").textContent =
        "이전 자동 추정 작업을 완료하지 못했습니다. 실행 기록이나 상세 조건을 확인해주세요.";
    return;
  }
  $("tax-auto-status").textContent = "관세·환율·배송비 자동 추정 중…";
  clearTimeout(automaticTimer);
  automaticTimer = setTimeout(() => {
    if (token === revision)
      refresh(token, false).catch((e) => {
        $("tax-auto-status").textContent = explain(e.message);
      });
  }, 1000);
}
export function refreshAutomaticCustoms() {
  if (current)
    refresh(revision).catch((e) => {
      $("tax-auto-status").textContent = explain(e.message);
    });
}
export function cancelCustoms() {
  clearTimeout(automaticTimer);
  revision++;
  current = null;
}
export function showCustoms(item) {
  clearTimeout(automaticTimer);
  current = item;
  classification = null;
  lastClassificationId = undefined;
  automaticPolls = 0;
  revision++;
  $("tax-form").reset();
  $("tax-hint").value = "";
  $("tax-classification").replaceChildren();
  $("tax-result").replaceChildren();
  $("tax-profile").replaceChildren(node("option", "먼저 품목 추론"));
  const form = $("tax-form"),
    p = item.observation.data;
  form.elements.currency.value = ["JPY", "USD", "KRW"].includes(p.currency)
    ? p.currency
    : "JPY";
  form.elements.goods.value = p.price ?? "";
  form.elements.domestic.value =
    p.domesticShipping.currency === p.currency
      ? (p.domesticShipping.amount ?? "")
      : "";
  form.elements.referenceDate.value = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  stage(2, "running");
  const token = revision;
  refresh(token).catch((e) => {
    if (token === revision) {
      stage(2, "error");
      message(explain(e.message));
    }
  });
}
export function bindCustomsControls() {
  $("tax-auto-retry").onclick = () =>
    requestAutomatic().catch((e) => {
      $("tax-auto-status").textContent = explain(e.message);
    });
  $("tax-analyze").onclick = async () => {
    if (!current) return;
    const item = current,
      token = revision,
      generation = ++state.generation;
    $("tax-analyze").disabled = true;
    message("품목을 추론하고 있습니다…");
    try {
      const r = await api(`listings/${item.listing.id}/tax-analysis`, {
        hint: $("tax-hint").value,
      });
      const done = await poll(r.runId, generation, () => {});
      if (token !== revision) return;
      if (done?.work.status !== "succeeded")
        throw Error(done?.work.error_type || "tax_analysis_in_progress");
      await refresh(token);
      if (classification?.data.candidates.length)
        message("후보 품목과 비용·과세환율을 확인한 뒤 계산해주세요.");
    } catch (e) {
      if (token === revision) {
        stage(2, "error");
        message(explain(e.message));
      }
    } finally {
      $("tax-analyze").disabled = false;
    }
  };
  $("tax-profile").onchange = () => {
    $("tax-confirm").checked = false;
    const p = metadata?.profiles[$("tax-profile").value];
    $("tax-rate-preview").textContent =
      p?.calculationStatus === "needs_review"
        ? p.reviewReason
        : p
          ? `기본 관세 ${p.duty}% · 주세 ${p.liquor}% · 교육세(주세 기준) ${p.education}% · 부가세 10%. 소액면세 여부는 별도 판단합니다.`
          : "품목을 선택해주세요.";
  };
  $("tax-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!current || !classification) {
      message("최신 상품의 품목 추론이 필요합니다.");
      return;
    }
    const token = revision,
      item = current,
      form = $("tax-form"),
      values = Object.fromEntries(new FormData(form));
    const profile = values.profile,
      alcohol = (metadata?.profiles[profile]?.liquor || 0) > 0;
    const input = {
      observationId: item.observation.id,
      classificationId: classification.id,
      profile,
      confirmed: $("tax-confirm").checked,
      route: values.route,
      personalUse: form.elements.personalUse.checked,
      currency: values.currency,
      goods: values.goods,
      domestic: values.domestic,
      international: values.international,
      insurance: values.insurance,
      additions: values.additions,
      shippingSeparated: form.elements.shippingSeparated.checked,
      fx: {
        jpyToKrw: values.jpyToKrw,
        usdToKrw: values.usdToKrw,
        validFrom: values.validFrom,
        validTo: values.validTo,
        referenceDate: values.referenceDate,
      },
      alcohol: alcohol
        ? {
            bottles: Number(values.bottles),
            mlPerBottle: Number(values.mlPerBottle),
            abv: Number(values.abv),
          }
        : null,
    };
    if (
      alcohol &&
      [values.bottles, values.mlPerBottle, values.abv].some((x) => !x)
    ) {
      message("주류 병수·병당 용량·도수를 확인해주세요.");
      return;
    }
    $("tax-calculate").disabled = true;
    try {
      const result = await api(`listings/${item.listing.id}/tax-quotes`, input);
      if (token !== revision) return;
      renderEstimate(result);
      message(
        result.taxes
          ? "기본세율 시나리오 계산 완료. 실제 적용 세율은 달라질 수 있습니다."
          : result.reason,
      );
    } catch (e) {
      if (token === revision) {
        stage(2, "error");
        message(explain(e.message));
      }
    } finally {
      $("tax-calculate").disabled = false;
    }
  };
}
