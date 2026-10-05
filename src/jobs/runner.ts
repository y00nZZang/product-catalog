import { analyzeTax } from "../customs/service";
import { claim, recover, heartbeat } from "../persistence/job-queue.repository";
import { collect } from "../ingestion/collector";
import { analyzePackage } from "../packaging/service";
import { pool } from "../persistence/connection";
import { workerFailure } from "./errors";
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
export async function runWorker() {
  console.log("Catalog worker started");
  while (!stopped) {
    let phase = "recover";
    try {
      await recover();
      phase = "claim";
      const run = await claim();
      if (run) {
        const timer = setInterval(() => heartbeat(run).catch(() => {}), 30000);
        try {
          phase = "collect";
          const result =
            run.kind === "tax_analysis"
              ? await analyzeTax(run)
              : run.kind === "package_analysis"
                ? await analyzePackage(run)
                : await collect(run);
          console.log(JSON.stringify({ runId: run.id, ...result }));
        } finally {
          clearInterval(timer);
        }
        continue;
      }
    } catch (error) {
      const failure = workerFailure(error, phase);
      console.error(JSON.stringify(failure));
      if (failure.action === "stopping") {
        process.exitCode = 1;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
