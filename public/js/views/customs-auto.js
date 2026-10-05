import { renderTariffs } from "./tariff.js";
import { $, node, links } from "../dom.js";
const money = (n) => `${Math.round(n).toLocaleString()}원`;
const range = (r) =>
  r.min === r.max ? money(r.min) : `${money(r.min)} ~ ${money(r.max)}`;
export function renderAutomaticCustoms(record, fresh) {
  const root = $("tax-auto-result");
  root.replaceChildren();
  if (!record) {
    root.append(
      node("p", "상품 정보를 바탕으로 관세와 비용을 자동 추정합니다.", "hint"),
    );
    return;
  }
  const d = record.data;
  renderTariffs(root, d.tariffLookup);
  if (d.hsClassification) {
    const hs = d.hsClassification;
    root.append(node("h3", "HS 품목분류 후보"));
    for (const c of hs.candidates || []) {
      root.append(
        node("p", `${c.label} · HS ${c.code} (후보)`),
        node("p", c.description, "hint"),
        node("p", c.rationale, "hint"),
      );
      root.append(
        node("p", `원문 근거: ${(c.evidenceQuotes || []).join(" / ")}`, "hint"),
      );
    }
    root.append(node("p", hs.explanation, "hint"));
    for (const m of hs.missingInformation || [])
      root.append(node("p", m, "notice"));
    root.append(
      node(
        "p",
        "표시된 자릿수까지의 HS 2022 후보입니다. 한국 HSK 10자리 확정·세율 확인·수입 가능 여부는 별도입니다.",
        "hint",
      ),
    );
    const source = node("div");
    links(source, [hs.source, ...(hs.researchSources || [])]);
    root.append(source);
  }
  if (!fresh)
    root.append(
      node(
        "p",
        "상품·포장·환율 조건이 바뀌어 이전 추정치가 표시됩니다. 새 결과를 계산합니다.",
        "notice",
      ),
    );
  if (d.shippingRangeKrw)
    root.append(
      node("p", `확인된 국제배송·취급 비용 ${range(d.shippingRangeKrw)}`),
    );
  if (d.taxRangeKrw) {
    root.append(
      node(
        "h3",
        `예상 세금 ${range(d.taxRangeKrw)} · ${d.publicTariffApplied ? "공개 HSK 기본세율" : "기본세율 가정"}`,
      ),
    );
    if (d.knownTotalRangeKrw)
      root.append(
        node(
          "p",
          `상품·배송·세금의 확인된 비용 합계 ${range(d.knownTotalRangeKrw)}`,
        ),
      );
  } else root.append(node("h3", "추정에 필요한 자료를 확인하지 못했습니다."));
  root.append(
    node(
      "p",
      d.rangeComplete
        ? "기본세율·포장 가정에 따른 예상치입니다."
        : "미확인 비용·분류·신고 조건이 남아 있어 확정 총액이 아닙니다.",
      "notice",
    ),
  );
  if (d.fx)
    root.append(
      node(
        "p",
        `관세청 ${d.fx.sourceKind === "official_api" ? "API" : "공개 주간환율"} · ${d.fx.validFrom} ~ ${d.fx.validTo} · 1엔 ${d.fx.jpyToKrw}원 / 1달러 ${d.fx.usdToKrw}원`,
        "hint",
      ),
    );
  for (const missing of d.missingInformation || [])
    root.append(node("p", missing, "hint"));
  const detail = node("details"),
    summary = node("summary", "추정 근거·배송 방식별 시나리오");
  detail.append(summary);
  for (const s of d.scenarios || []) {
    const card = node("div", null, "tax-auto-scenario");
    card.append(node("strong", `${s.provider} · ${s.label} · ${s.scenario}`));
    card.append(
      node(
        "p",
        s.tax?.totalTaxKrw != null
          ? `세금 ${money(s.tax.totalTaxKrw)} · 확인된 합계 ${money(s.knownTotalKrw)}`
          : s.reason || "추가 확인 필요",
      ),
    );
    if (s.tax?.taxes) {
      const t = s.tax.taxes;
      card.append(
        node(
          "p",
          `관세 ${money(t.duty)} · 주세 ${money(t.liquor)} · 교육세 ${money(t.education)} · 부가세 ${money(t.vat)}`,
          "hint",
        ),
      );
    }
    for (const warning of s.missingCosts || [])
      card.append(node("p", warning, "hint"));
    detail.append(card);
  }
  for (const a of d.assumptions || []) detail.append(node("p", a, "hint"));
  if (d.fx) {
    const source = node("div");
    links(source, [d.fx.source]);
    detail.append(source);
  }
  root.append(detail);
}
