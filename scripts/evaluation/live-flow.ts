/** Explicit opt-in smoke run against the local API. Uses its normal TTL and AI cache;
 * never retries a paid request, forces a refresh, or asserts measurement accuracy. */
import { existsSync, writeFileSync } from "node:fs";
import { config } from "../../src/config";
const output = process.argv[2];
if (!output || !process.argv.includes("--live")) {
  console.error(
    "Usage: tsx scripts/evaluation/live-flow.ts report.json --live (may call paid providers)",
  );
  process.exit(1);
}
if (existsSync(output)) {
  console.error("Report already exists; choose a new output path.");
  process.exit(1);
}
const samples = [
  { category: "media", url: "https://books.rakuten.co.jp/rb/18814391/" },
  { category: "plush", url: "https://jp.mercari.com/item/m96268518460" },
  { category: "figure", url: "https://jp.mercari.com/item/m97353521132" },
  { category: "high_price", url: "https://jp.mercari.com/item/m91380829552" },
  {
    category: "alcohol",
    url: "https://item.rakuten.co.jp/r-concier/whisky-00294/",
  },
];
const report: any = {
  startedAt: new Date().toISOString(),
  kind: "local_live_url_flow_not_accuracy",
  environment: config.environment,
  model: config.model,
  forceRefresh: false,
  samples: [],
};
const save = () =>
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
async function api(path: string, body?: object): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${config.port}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(config.accessToken
        ? { Authorization: `Bearer ${config.accessToken}` }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw Error(data.error || `http_${response.status}`);
  return data;
}

// Keep report evidence bounded: scenario results, not a repeated copy of every rate profile.
function summarizeAutomatic(data: any) {
  if (!data) return null;
  return {
    ...data,
    scenarios: (data.scenarios || []).map((s: any) => ({
      ...s,
      tax: s.tax
        ? {
            taxes: s.tax.taxes,
            totalTaxKrw: s.tax.totalTaxKrw,
            exemption: s.tax.exemption,
            reason: s.tax.reason,
            taxableValueKrw: s.tax.taxableValueKrw,
            metadata: s.tax.metadata
              ? {
                  version: s.tax.metadata.version,
                  checkedAt: s.tax.metadata.checkedAt,
                  rateBasis: s.tax.metadata.rateBasis,
                }
              : null,
            input: s.tax.input,
          }
        : null,
    })),
  };
}

const active = (status: string) =>
  ["queued", "running", "waiting"].includes(status);
async function until(read: () => Promise<any>, pending: (x: any) => boolean) {
  const deadline = performance.now() + 300000;
  while (true) {
    const value = await read();
    if (!pending(value)) return value;
    if (performance.now() > deadline)
      throw Error("observation_timeout_job_may_still_be_running");
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const trace = (d: any) => ({
  runId: d.work.id,
  status: d.work.status,
  error: d.work.error_type,
  cacheHit: d.request.cache_hit,
  totalMs: d.request.total_ms,
  processingMs: d.work.processing_ms,
  steps: d.steps.map((s: any) => ({
    stage: s.stage,
    status: s.status,
    method: s.method,
    durationMs: s.duration_ms,
    error: s.error_type,
    cacheHit: s.metadata?.cacheHit || false,
    inputTokens: s.input_tokens,
    outputTokens: s.output_tokens,
    searchCalls: s.search_calls,
    costUsd: s.cost_usd,
  })),
});
(async () => {
  for (const sample of samples) {
    const row: any = { ...sample, startedAt: new Date().toISOString() };
    report.samples.push(row);
    save();
    console.log(`Starting ${sample.category}`);
    try {
      const requested = await api("analyses", { url: sample.url });
      row.listingId = requested.listingId;
      row.requestRunId = requested.runId;
      save();
      const done = await until(
        () => api("analyses/" + requested.runId),
        (x) => active(x.work.status),
      );
      row.collection = trace(done);
      const r = done.result,
        p = r?.observation?.data;
      row.product = p
        ? {
            observationId: r.observation.id,
            observedAt: r.observation.observed_at,
            stale: r.observation.stale,
            title: p.title,
            price: p.price,
            currency: p.currency,
            availability: p.availability,
            sourceType: p.sourceType,
            warnings: p.warnings,
          }
        : null;
      row.package = r?.logistics?.data?.package || null;
      row.packageReason = r?.logistics?.data?.reason;
      row.packageComplete =
        !!row.package &&
        ["weightGrams", "lengthCm", "widthCm", "heightCm"].every(
          (k) => row.package[k] > 0,
        );
      save();
      if (done.work.status === "succeeded") {
        const customs = await until(
          () => api(`listings/${requested.listingId}/customs`),
          (x) => active(x.autoRun?.status),
        );
        row.customsFresh = customs.automaticFresh;
        row.classification = customs.classification?.data;
        row.automatic = summarizeAutomatic(customs.automatic?.data);
        if (customs.autoRun?.id)
          row.taxRun = trace(await api("analyses/" + customs.autoRun.id));
        const second = await api("analyses", { url: sample.url });
        const repeat = await api("analyses/" + second.runId);
        row.repeat = {
          ...trace(repeat),
          sameObservation: repeat.result?.observation?.id === r.observation.id,
        };
      }
      row.finishedAt = new Date().toISOString();
      console.log(
        JSON.stringify({
          category: row.category,
          collection: row.collection.status,
          packageComplete: row.packageComplete,
          customs: row.automatic?.status,
          cacheHit: row.repeat?.cacheHit,
        }),
      );
    } catch (e) {
      row.error = e instanceof Error ? e.message : "unknown_error";
      console.log(`${sample.category}: ${row.error}`);
    }
    save();
  }
  report.finishedAt = new Date().toISOString();
  save();
})().catch(() => {
  console.error("Live flow runner failed");
  process.exitCode = 1;
});
