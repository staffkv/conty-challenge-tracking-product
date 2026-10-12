import { z } from "zod";

export const MAX_LIMIT_DAYS = 90;

export const lookupSchema = z.strictObject({
  tracking_code: z
    .string()
    .trim()
    .min(1, "informe o código de rastreio")
    .transform((code) => code.toUpperCase()),
  carrier: z
    .string()
    .trim()
    .transform((carrier) => carrier.toLowerCase())
    .optional(),
});

export const registerSchema = z.strictObject({
  tracking_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{8,40}$/, "use de 8 a 40 letras ou números, sem espaços")
    .transform((code) => code.toUpperCase()),
  carrier: z
    .string()
    .trim()
    .min(1, "informe a transportadora")
    .transform((carrier) => carrier.toLowerCase()),
  transit_limit_days: z.number().int("use um número inteiro de dias").min(1).max(MAX_LIMIT_DAYS).optional(),
  reference: z.string().trim().min(1).max(200).optional(),
});
