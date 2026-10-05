import { $, node, links } from "../dom.js";
import { labels } from "../labels.js";
import { money } from "../format.js";
export function renderQuotes(data) {
  $("quotes").replaceChildren();
  if (!data?.quotes?.length) {
    $("quotes").append(
      node(
        "p",
        "포장 정보를 입력하면 배송대행 업체별 견적이 표시됩니다.",
        "empty-state",
      ),
    );
    return;
  }
  for (const q of data.quotes) {
    const card = node("article", null, "quote");
    card.append(
      node(
        "h3",
        `${q.provider === "tenso" ? "텐소" : "몰테일"} · ${q.method.toUpperCase()}`,
      ),
      node("span", labels[q.status] || q.status, "badge"),
      node("p", money(q.knownSubtotal, q.currency), "quote-total"),
    );
    if (q.fx)
      card.append(
        node(
          "p",
          `약 ${money(q.convertedKnownSubtotal, "KRW")} · 환율 기준 ${q.fx.date}`,
          "hint",
        ),
      );
    const dl = node("dl");
    for (const [label, value] of [
      ["국제 운임", money(q.freight, q.currency)],
      ["취급료", money(q.handling, q.currency)],
      ["할증료", money(q.surcharge, q.currency)],
    ])
      dl.append(node("dt", label), node("dd", value));
    card.append(
      dl,
      node("p", q.notes.join(" · "), "hint"),
      node(
        "p",
        `계산 조건 ${q.package.weightGrams}g · ${q.package.lengthCm}×${q.package.widthCm}×${q.package.heightCm}cm`,
        "hint",
      ),
      node("p", `요율 확인 ${q.rateCheckedAt}`, "hint"),
    );
    const refs = node("div", null, "source-links");
    links(refs, q.sources);
    card.append(refs);
    $("quotes").append(card);
  }
}
