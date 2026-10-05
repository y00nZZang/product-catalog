import { OpenAiExecutor, type ModelCaller } from "./executor";
import type { Product, Identity } from "../domain";
import { Recorder } from "../jobs/recorder";
import { supplement } from "./product-enrichment";
import { estimatePackage } from "./package-estimate";

/** Small facade for callers. Keeping call overridable preserves the existing no-network test seam. */
export class AiService {
  constructor(private readonly executor: ModelCaller = new OpenAiExecutor()) {}
  call(...args: Parameters<OpenAiExecutor["call"]>) {
    return this.executor.call(...args);
  }
  supplement(product: Product, text: string, id: Identity, rec: Recorder) {
    return supplement(this, product, text, id, rec);
  }
  suggestPackage(product: Product, id: Identity, rec: Recorder, hint = "") {
    return estimatePackage(this, product, id, rec, hint);
  }
  researchPackage(product: Product, id: Identity, rec: Recorder) {
    return estimatePackage(this, product, id, rec);
  }
}
