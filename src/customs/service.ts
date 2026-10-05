import { resolveTariffs } from "./tariff/resolver";
import { automaticTax } from "./automatic";
import { getCustomsFx } from "./fx";
import { latestTaxLogistics } from "../persistence/customs-auto.repository";
import { TAX_VERSION } from "./profiles";
import { classifyTax } from "./classifier";
import { calculateTax } from "./calculator";
import { taxQuoteRequest } from "./schema";
import { getListing } from "../persistence/catalog.repository";
import {
  readPackageObservation,
  failPackageAnalysis,
  releasePackageSite,
} from "../persistence/package.repository";
import {
  completeTaxRun,
  readTaxClassification,
  saveTaxEstimate,
} from "../persistence/customs.repository";
import { createQuoteRun, failQuote } from "../persistence/quote.repository";
import { pool } from "../persistence/connection";
import { Recorder } from "../jobs/recorder";
import { OpenAiExecutor, type ModelCaller } from "../ai/executor";
import { config } from "../config";
import { CatalogError, errorCode, type ClaimedRun } from "../domain";
export async function analyzeTax(
  run: ClaimedRun,
  caller?: ModelCaller,
  fxGetter = getCustomsFx,
) {
  const start = performance.now();
  let error: string | null = null;
  try {
    const product = await readPackageObservation(run),
      rec = new Recorder(run.id, run.attempt);
    const result = await rec.step(
      "customs_classification",
      "rules_or_llm",
      null,
      () =>
        classifyTax(
          product,
          run.input.hint || "",
          rec,
          caller || (config.llm ? new OpenAiExecutor() : undefined),
        ),
    );
    let automaticResult: object | undefined;
    if (config.autoCustoms) {
      const logistics = await latestTaxLogistics(
        pool,
        run.listing_id,
        run.observation_id!,
      );
      let fx = null,
        fxError: string | null = null;
      try {
        fx = await rec.step("customs_fx", "official_weekly", null, () =>
          fxGetter(),
        );
      } catch (e) {
        fxError = errorCode(e);
      }
      const tariffs = await resolveTariffs(
        product,
        result.hsClassification,
        rec,
        caller || (config.llm ? new OpenAiExecutor() : undefined),
        fx?.referenceDate,
        undefined,
        run.input.hint || "",
      );
      automaticResult = {
        ...automaticTax(product, logistics?.data, result, fx, fxError, tariffs),
        logisticsId: logistics?.id || null,
      };
    }
    await completeTaxRun(run, result, start, automaticResult);
  } catch (e) {
    error = errorCode(e);
    await failPackageAnalysis(run, error, start);
  } finally {
    await releasePackageSite(run);
  }
  return { status: error ? "failed" : "succeeded", error };
}
export async function createTaxQuote(listingId: string, raw: unknown) {
  const input = taxQuoteRequest.parse(raw),
    item = await getListing(listingId);
  if (item.observation?.id !== input.observationId)
    throw new CatalogError("tax_observation_changed");
  const classification = await readTaxClassification(
    input.classificationId,
    listingId,
    input.observationId,
  );
  if (
    !classification ||
    classification.data.version !== TAX_VERSION ||
    classification.data.unsupported ||
    !classification.data.candidates.some(
      (c: { profile: string }) => c.profile === input.profile,
    )
  )
    throw new CatalogError("tax_classification_required");
  const runId = await createQuoteRun(listingId, input.observationId);
  await pool.query("UPDATE analysis_runs SET kind='tax_quote' WHERE id=$1", [
    runId,
  ]);
  const start = performance.now();
  try {
    const result = await new Recorder(runId).step(
      "tax_calculate",
      "versioned_rate_table",
      null,
      async () => calculateTax(input),
    );
    await saveTaxEstimate(
      runId,
      listingId,
      input.observationId,
      { ...result, input },
      start,
    );
    return { runId, ...result };
  } catch (e) {
    await failQuote(runId, errorCode(e), start);
    throw e;
  }
}
