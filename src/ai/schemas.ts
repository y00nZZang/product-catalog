import { z } from "zod";
/** Model schemas describe proposals. Acceptance checks live in the workflow that consumes them. */

export const manualPackageSpec = z.object({
  evidenceQuotes: z.array(z.string()),
  match: z.enum(["matched", "uncertain"]),
  weightGrams: z.number().nullable(),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  sources: z.array(z.string()),
  assumptions: z.array(z.string()),
  explanation: z.string(),
});

export const field = z.object({
  value: z.string().nullable(),
  evidence: z.string().nullable(),
});

export const extracted = z.object({
  title: field,
  description: field,
  seller: field,
  price: field,
  currency: field,
  condition: field,
  domesticShipping: field,
  translatedTitle: z.string().nullable(),
});

export const spec = z.object({
  matchedIdentifier: z.string().nullable(),
  packageWeightGrams: z.number().nullable(),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  basis: z.enum(["verified", "estimated", "unknown"]),
  sources: z.array(z.string()),
  assumptions: z.array(z.string()),
  productWeightGrams: z.number().nullable(),
});
