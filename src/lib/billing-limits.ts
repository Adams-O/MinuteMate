import "server-only";
import { z } from "zod";

const FreePlanLimitsSchema = z.object({
  meetings: z.number().int().min(1).max(1000),
  audioSeconds: z.number().int().min(1).max(31 * 24 * 60 * 60),
});

export type FreePlanLimits = z.infer<typeof FreePlanLimitsSchema>;

export function getFreePlanLimits(): FreePlanLimits | null {
  const limits = FreePlanLimitsSchema.safeParse({
    meetings: process.env.FREE_PLAN_MAX_MEETINGS === undefined
      ? 3
      : Number(process.env.FREE_PLAN_MAX_MEETINGS),
    audioSeconds: process.env.FREE_PLAN_MAX_AUDIO_SECONDS === undefined
      ? 5400
      : Number(process.env.FREE_PLAN_MAX_AUDIO_SECONDS),
  });
  return limits.success ? limits.data : null;
}
