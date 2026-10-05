import { api } from "../api.js";
import { $ } from "../dom.js";

let pending = null;
// Reuse the server's current-week cache and coalesce overlapping UI refreshes.
export function loadCurrentFx() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const fx = await api("listings/tax-fx");
      const format = (value) =>
        Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 4 });
      $("current-fx-values").textContent =
        `1 JPY = ${format(fx.jpyToKrw)}원 · 1 USD = ${format(fx.usdToKrw)}원`;
      $("current-fx-period").textContent =
        `${fx.validFrom} ~ ${fx.validTo} 적용`;
    } catch {
      // Never leave an earlier week's values labelled as current after a failed refresh.
      $("current-fx-values").textContent = "현재 환율 조회 불가";
      $("current-fx-period").textContent =
        "잠시 후 ‘목록 갱신’으로 다시 확인하세요.";
    } finally {
      pending = null;
    }
  })();
  return pending;
}
