import { node, links } from "../dom.js";
const rateText = (r) => (r.rate == null ? r.rawRate || "미확인" : `${r.rate}%`);
export function renderTariffs(root, data) {
  if (!data) return;
  root.append(
    node("h3", "한국 HSK·공개 세율"),
    node("p", `기준일 ${data.referenceDate} · 기본세율 기준 참고 견적`, "hint"),
  );
  for (const item of data.candidates || []) {
    root.append(
      node("strong", `${item.hsk} · ${item.name}`),
      node(
        "p",
        `기본세율(A) ${rateText(item.rate)} · ${item.rate.validFrom} ~ ${item.rate.validTo}`,
      ),
    );
    root.append(
      node(
        "p",
        item.eligible
          ? "일반 부가세 10% 가정으로 계산합니다. 양허·협정 및 개별 감면은 적용하지 않습니다."
          : item.reason,
        "hint",
      ),
    );
    root.append(node("p", item.rationale, "hint"));
    const sources = node("div");
    links(sources, [`${item.source}?hsSgn=${item.hsk}`]);
    root.append(sources);
    root.append(
      node(
        "p",
        `조회 시각 ${new Date(item.fetchedAt).toLocaleString()}`,
        "hint",
      ),
    );
    const others = (item.alternatives || []).filter((r) => r.type !== "A");
    if (others.length) {
      const details = node("details");
      details.append(
        node("summary", `다른 세율 ${others.length}개 · 적용조건 미확인`),
        node(
          "p",
          "아래 세율을 자동 적용하거나 최솟값으로 선택하지 않습니다. 원산지·대상국·협정 및 품목별 요건 확인이 필요합니다.",
          "hint",
        ),
      );
      for (const r of others)
        details.append(
          node(
            "p",
            `${r.type === "C" ? "WTO협정세율(C)" : r.type}: ${rateText(r)}${r.unitAmount ? ` · 단위당 세액 원문 ${r.unitAmount}` : ""} · ${r.validFrom} ~ ${r.validTo}`,
            "hint",
          ),
        );
      root.append(details);
    }
  }
  for (const m of data.missingInformation || [])
    root.append(node("p", m, "hint"));
}
