import { config } from "../config";
import { CatalogError, identify, errorCode, type ClaimedRun } from "../domain";
import { Recorder } from "../jobs/recorder";
import { AiService } from "../ai/service";
import {
  enqueuePackageAnalysis,
  readPackageObservation,
  commitPackageAnalysis,
  failPackageAnalysis,
  releasePackageSite,
} from "../persistence/package.repository";
export async function requestPackageAnalysis(listingId: string, hint: string) {
  if (!config.llm) throw new CatalogError("llm_disabled");
  return enqueuePackageAnalysis(listingId, hint);
}
/** The queue freezes the observation version so later catalog refreshes cannot silently change AI input. */
export async function analyzePackage(
  run: ClaimedRun,
  suggest?: AiService["suggestPackage"],
) {
  const start = performance.now();
  let error: string | null = null;
  try {
    const product = await readPackageObservation(run);
    const service = new AiService();
    const invoke = suggest || service.suggestPackage.bind(service);
    const result = await invoke(
      product,
      identify(run.canonical_url),
      new Recorder(run.id, run.attempt),
      run.input.hint || "",
    );
    await commitPackageAnalysis(run, result, start);
  } catch (e) {
    error = errorCode(e);
    await failPackageAnalysis(run, error, start);
  } finally {
    await releasePackageSite(run);
  }
  return {
    status: error ? "failed" : "succeeded",
    ...(error ? { error } : {}),
  };
}
