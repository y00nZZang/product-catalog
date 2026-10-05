import { $, node } from "../dom.js";
import { labels, methods, stages } from "../labels.js";
import { ms } from "../format.js";
const runs = new Map();
export function clearRunHistory() {
  runs.clear();
}
export function renderRun(d) {
  runs.set(d.work.id, d);
  $("timing").hidden = false;
  const r = d.request,
    w = d.work;
  $("run-mode").textContent = r.cache_hit
    ? "저장 결과 재사용"
    : w.kind === "automatic_customs" || w.kind === "tax_analysis"
      ? "관세 추정"
      : w.kind === "package_analysis"
        ? "포장 재추정"
        : r.shared_run_id
          ? "진행 중 작업 공유"
          : "새 분석";
  $("run-time").textContent =
    `최근 표시 작업의 요청 경과 ${ms(r.total_ms)} · 대기 ${ms(w.queue_ms)} · 처리 ${ms(w.processing_ms)} · ${w.environment}/${w.region}`;
  $("steps").replaceChildren();
  for (const entry of runs.values())
    for (const s of entry.steps) {
      const tr = node("tr");
      for (const v of [
        stages[s.stage] || s.stage,
        (methods[s.method] || s.method) +
          (s.metadata?.cacheHit ? " · 재사용" : ""),
        s.attempt,
        labels[s.status] || s.status,
        ms(s.duration_ms),
        s.cost_usd == null ? "—" : `$${Number(s.cost_usd).toFixed(5)}`,
      ])
        tr.append(node("td", v));
      $("steps").append(tr);
    }
  if (r.cache_hit) {
    const tr = node("tr"),
      td = node("td", "외부 수집 없이 저장된 결과를 반환했습니다.");
    td.colSpan = 6;
    tr.append(td);
    $("steps").append(tr);
  }
}
