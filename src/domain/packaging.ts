import { z } from "zod";

/** A package includes its packaging material; these are not the product-only measurements. */

export const packageSchema = z.object({
  weightGrams: z.number().positive().max(30000),
  lengthCm: z.number().positive().max(200),
  widthCm: z.number().positive().max(200),
  heightCm: z.number().positive().max(200),
  basis: z.enum(["user_measured", "user_assumption", "estimated", "verified"]),
  source: z.string().min(1).max(2000),
  assumptions: z.array(z.string().max(1000)).max(10).default([]),
});

export type PackageInput = z.infer<typeof packageSchema>;
