import { z } from "zod";
export const measurementKeys = [
  "weightGrams",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const;
const range = z.object({
  low: z.number(),
  typical: z.number(),
  high: z.number(),
});
const field = z.object({
  range: range.nullable(),
  basis: z.enum([
    "exact_spec",
    "similar_product",
    "visual_estimate",
    "packing_allowance",
    "user_hint",
    "model_assumption",
    "unknown",
  ]),
  evidence: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export const measurements = z.object({
  weightGrams: field,
  lengthCm: field,
  widthCm: field,
  heightCm: field,
});
export const visualSchema = z.object({
  category: z.string(),
  identityClues: z.array(z.string()),
  quantity: z.number().int().nullable(),
  boxIncluded: z.enum(["yes", "no", "unknown"]),
  observations: z.array(z.string()),
  uncertainties: z.array(z.string()),
  searchQuery: z.string(),
});
export const estimateSchema = z.object({
  product: measurements,
  package: z.object({
    weightGrams: field.extend({ range }),
    lengthCm: field.extend({ range }),
    widthCm: field.extend({ range }),
    heightCm: field.extend({ range }),
  }),
  assumptions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  explanation: z.string(),
});
export type Measurements = z.infer<typeof measurements>;
export type PackageEstimate = z.infer<typeof estimateSchema>;
