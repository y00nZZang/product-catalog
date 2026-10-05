import { $, node } from "../dom.js";
export function renderListings(rows, onSelect) {
  $("listings").replaceChildren();
  if (!rows.length)
    $("listings").append(node("li", "아직 저장된 상품이 없습니다.", "hint"));
  for (const item of rows) {
    const li = node("li"),
      button = node("button", item.title || item.canonical_url);
    button.onclick = () => onSelect(item);
    li.append(
      button,
      node(
        "div",
        `${item.platform === "rakuten" ? "라쿠텐" : "메루카리"} · ${item.observed_at ? new Date(item.observed_at).toLocaleString() : "수집 대기·실패"}`,
        "hint",
      ),
    );
    $("listings").append(li);
  }
}
export function renderListError() {
  $("listings").textContent =
    "목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
}
