import {
  beginStep,
  completeStep,
  failStep,
} from "../persistence/execution.repository";
import { randomUUID } from "node:crypto";

import { errorCode } from "../domain";
export class Recorder {
  constructor(
    readonly runId: string,
    readonly attempt = 1,
  ) {}
  async step<T>(
    stage: string,
    method: string,
    provider: string | null,
    work: (stepId: string) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();
    await beginStep(id, this.runId, stage, this.attempt, method, provider);
    const start = performance.now();
    try {
      const value = await work(id);
      await completeStep(id, start);
      return value;
    } catch (e) {
      await failStep(id, start, errorCode(e));
      throw e;
    }
  }
}
