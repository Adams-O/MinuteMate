import { z } from "zod";
import { getFreePlanLimits } from "@/lib/billing-limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const WorkspaceIdSchema = z.string().uuid();
const SubscriptionSchema = z.object({
  plan: z.enum(["free", "pro"]),
  status: z.enum(["active", "pending", "cancelled", "past_due"]),
  currency: z.string().nullable(),
  amount_minor: z.union([
    z.number(),
    z.string().regex(/^\d+$/).transform(Number),
  ]).nullable(),
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
});
const UsageEventSchema = z.object({
  event_type: z.enum(["meeting_created", "audio_minutes_reserved"]),
  quantity: z.number(),
  period_start: z.string(),
});

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!WorkspaceIdSchema.safeParse(workspaceId).success) {
    return Response.json({ error: "Choose a valid workspace." }, { status: 400 });
  }
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Billing is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to view billing." }, { status: 401 });
  const freePlanLimits = getFreePlanLimits();
  if (!freePlanLimits) return Response.json({ error: "Billing limits are not configured." }, { status: 503 });

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [{ data: subscriptionRow, error: subscriptionError }, { data: usageRows, error: usageError }] = await Promise.all([
    supabase.from("subscriptions")
      .select("plan, status, currency, amount_minor, current_period_start, current_period_end")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase.from("usage_events")
      .select("event_type, quantity, period_start")
      .eq("workspace_id", workspaceId)
      .eq("period_start", periodStart),
  ]);
  if (subscriptionError || usageError) return Response.json({ error: "Billing data could not be loaded." }, { status: 503 });
  const subscription = SubscriptionSchema.safeParse(subscriptionRow);
  const usage = UsageEventSchema.array().safeParse(usageRows ?? []);
  if (!subscription.success || !usage.success) {
    return Response.json({ error: "Billing data is unavailable." }, { status: 503 });
  }

  const isEntitled = subscription.data.plan === "pro"
    && subscription.data.status === "active"
    && !!subscription.data.current_period_end
    && Date.parse(subscription.data.current_period_end) > Date.now();
  const configuredAmount = Number(process.env.PAYSTACK_AMOUNT_MINOR);
  const configuredCurrency = process.env.PAYSTACK_CURRENCY ?? "NGN";
  let price: { display: string } | null = null;
  if (Number.isSafeInteger(configuredAmount) && configuredAmount > 0 && /^[A-Z]{3}$/.test(configuredCurrency)) {
    try {
      const formatter = new Intl.NumberFormat("en", { style: "currency", currency: configuredCurrency });
      const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
      price = {
        display: formatter.format(configuredAmount / 10 ** fractionDigits),
      };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return Response.json({
    subscription: {
      ...subscription.data,
      plan: isEntitled ? "pro" : "free",
      status: subscription.data.plan === "pro" && !isEntitled
        ? "past_due"
        : subscription.data.status,
    },
    isEntitled,
    price,
    usage: {
      meetings: usage.data.filter((event) => event.event_type === "meeting_created")
        .reduce((total, event) => total + event.quantity, 0),
      audioSeconds: usage.data.filter((event) => event.event_type === "audio_minutes_reserved")
        .reduce((total, event) => total + event.quantity, 0),
      meetingLimit: freePlanLimits.meetings,
      audioSecondsLimit: freePlanLimits.audioSeconds,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
