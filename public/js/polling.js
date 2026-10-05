import { state } from "./state.js";
import { api } from "./api.js";
import { renderRun } from "./views/run.js";

// Selection changes revoke the UI generation, not the background job; late responses must not overwrite a different product.
export async function poll(runId, generationToken, onResult) {
  for (let n = 0; n < 300 && generationToken === state.generation; n++) {
    const analysis = await api("analyses/" + runId);
    if (generationToken !== state.generation) return;
    renderRun(analysis);
    onResult(analysis);
    if (!["queued", "running", "waiting"].includes(analysis.work.status))
      return analysis;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (generationToken === state.generation)
    throw Error(
      "작업이 계속 진행 중입니다. 잠시 후 목록에서 결과를 확인해주세요.",
    );
}
