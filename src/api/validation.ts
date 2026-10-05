import { z } from "zod";

export const uuid = (id: string) => z.string().uuid().parse(id);
export const analysisRequest = z
  .object({
    url: z.string().min(1).max(2048),
    refresh: z.boolean().default(false),
  })
  .strict();
export const packageAnalysisRequest = z
  .object({ hint: z.string().max(2000).default("") })
  .strict();
