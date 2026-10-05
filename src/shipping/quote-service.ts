import {
  createQuoteRun,
  commitQuote,
  failQuote,
} from "../persistence/quote.repository";

import { getListing } from "../persistence/catalog.repository";
import { CatalogError, errorCode, packageSchema } from "../domain";
import { Recorder } from "../jobs/recorder";
import { quotePackage } from "./calculator";
import { withConversions } from "./fx";

/** Quote calculation is a use case, independent of HTTP routing. */
export async function calculateQuote(id: string, body: unknown) {
  const pkg = packageSchema.parse(body);
  // API submissions are user assertions, never verified website measurements.
  if (!["user_assumption", "user_measured"].includes(pkg.basis))
    throw new CatalogError("invalid_package_basis");
  const item = await getListing(id);
  if (!item.observation) throw new CatalogError("observation_required");
  const runId = await createQuoteRun(id, item.observation.id);
  const started = performance.now();
  try {
    const data = await new Recorder(runId).step(
      "quote",
      "rate_table",
      null,
      async () => withConversions(quotePackage(pkg, item.observation.data)),
    );
    await commitQuote(runId, id, item.observation.id, pkg, data, started);
    return { runId, ...data };
  } catch (e) {
    await failQuote(runId, errorCode(e), started);
    throw e;
  }
}
