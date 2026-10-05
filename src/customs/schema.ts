import { z } from "zod";
import { profileIds } from "./profiles";
export const taxAnalysisRequest = z
  .object({
    hint: z.string().max(2000).default(""),
    automatic: z.boolean().default(false),
  })
  .strict();
const money = z.string().regex(/^\d{1,10}(\.\d{1,6})?$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export const taxQuoteRequest = z
  .object({
    observationId: z.string().uuid(),
    classificationId: z.string().uuid(),
    profile: z.enum(profileIds),
    confirmed: z.literal(true),
    route: z.enum(["express", "postal", "postal_general"]),
    personalUse: z.boolean(),
    currency: z.enum(["JPY", "USD", "KRW"]),
    goods: money,
    domestic: money,
    international: money,
    insurance: money,
    additions: money,
    shippingSeparated: z.boolean(),
    fx: z
      .object({
        jpyToKrw: money,
        usdToKrw: money,
        validFrom: date,
        validTo: date,
        referenceDate: date,
      })
      .strict(),
    alcohol: z
      .object({
        bottles: z.number().int().min(1).max(100),
        mlPerBottle: z.number().positive().max(20000),
        abv: z.number().min(0).max(100),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const taxCalculationSchema = taxQuoteRequest
  .omit({ confirmed: true, observationId: true, classificationId: true })
  .strip();
export type TaxCalculationInput = z.infer<typeof taxCalculationSchema>;
export type TaxInput = z.infer<typeof taxQuoteRequest>;
export const inferredSchema = z.object({
  candidates: z.array(
    z.object({
      profile: z.enum(profileIds),
      evidenceQuotes: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  alcohol: z.object({
    bottles: z.number().int().nullable(),
    mlPerBottle: z.number().nullable(),
    abv: z.number().nullable(),
    evidenceQuotes: z.array(z.string()),
  }),
  missingInformation: z.array(z.string()),
  explanation: z.string(),
  unsupported: z.boolean(),
});

export const hskCalculationSchema = taxCalculationSchema.extend({
  profile: z.string().regex(/^hsk:\d{10}:A$/),
});
export type HskCalculationInput = z.infer<typeof hskCalculationSchema>;
