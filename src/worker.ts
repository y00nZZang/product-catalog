import { runWorker } from "./jobs/runner";
runWorker().catch(() => {
  process.exitCode = 1;
});
