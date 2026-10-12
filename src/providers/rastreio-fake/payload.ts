import { z } from "zod";

// Formato bruto do agregador fictício. Nada fora desta pasta conhece estes nomes.

export const checkpointSchema = z.object({
  checkpoint_id: z.string(),
  checkpoint_time: z.string(),
  checkpoint_tz: z.string().nullish(),
  courier_status: z.string(),
  message: z.string(),
  location: z.string().nullish(),
});

export const trackingResponseSchema = z.object({
  data: z.object({
    tracking_number: z.string(),
    courier_code: z.string(),
    checkpoints: z.array(z.unknown()),
  }),
});

export type RawCheckpoint = z.infer<typeof checkpointSchema>;
