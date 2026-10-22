import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { verifyPaystackSignature } from "@/lib/paystack";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const WebhookSchema = z.object({
  event: z.string().max(100),
  data: z.object({
    reference: z.string().min(1).max(200),
    subscription_code: z.string().max(200).optional(),
    subscription: z.union([
      z.string().max(200),
      z.object({ subscription_code: z.string().max(200).optional() }).passthrough(),
    ]).nullable().optional(),
    customer: z.object({ customer_code: z.string().max(200).optional() }).passthrough().nullable().optional(),
  }).passthrough(),
}).passthrough();
const VerifiedTransactionSchema = z.object({
  status: z.literal(true),
  data: z.object({
    status: z.string(),
    reference: z.string().min(1).max(200),
    amount: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    metadata: z.object({ workspaceId: z.string().uuid().optional() }).passthrough().nullable().optional(),
  }).passthrough(),
}).passthrough();
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  const rawBody = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (rawBody === null) return Response.json({ error: "Webhook body is invalid." }, { status: 400 });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return Response.json({ error: "Webhook verification is unavailable." }, { status: 503 });
  if (!verifyPaystackSignature(rawBody, request.headers.get("x-paystack-signature"), secret)) {
    return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Webhook body is invalid." }, { status: 400 });
  }
  const payload = WebhookSchema.safeParse(rawPayload);
  if (!payload.success) return Response.json({ error: "Webhook payload is invalid." }, { status: 400 });
  if (payload.data.event !== "charge.success") return Response.json({ received: true }, { status: 200 });

  let verificationResponse: Response;
  try {
    verificationResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(payload.data.data.reference)}`,
      {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(12000),
      },
    );
  } catch {
    return Response.json({ error: "Payment verification is temporarily unavailable." }, { status: 503 });
  }
  const rawVerification: unknown = await verificationResponse.json().catch(() => null);
  const verified = VerifiedTransactionSchema.safeParse(rawVerification);
  const expectedAmount = Number(process.env.PAYSTACK_AMOUNT_MINOR);
  const expectedCurrency = process.env.PAYSTACK_CURRENCY ?? "NGN";
  if (
    !verificationResponse.ok || !verified.success ||
    verified.data.data.status !== "success" ||
    verified.data.data.reference !== payload.data.data.reference ||
    !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 ||
    verified.data.data.amount !== expectedAmount ||
    verified.data.data.currency !== expectedCurrency
  ) {
    return Response.json({ error: "Payment could not be verified." }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Payment processing is unavailable." }, { status: 503 });
  }
  let workspaceId = verified.data.data.metadata?.workspaceId;
  const nestedSubscriptionCode = typeof payload.data.data.subscription === "string"
    ? payload.data.data.subscription
    : payload.data.data.subscription?.subscription_code;
  const providerSubscriptionId = payload.data.data.subscription_code
    ?? nestedSubscriptionCode;
  if (!workspaceId && providerSubscriptionId) {
    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("workspace_id")
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();
    if (subscriptionError) return Response.json({ error: "Payment workspace could not be resolved." }, { status: 503 });
    workspaceId = subscription?.workspace_id;
  }
  if (!workspaceId) return Response.json({ error: "Payment workspace could not be resolved." }, { status: 400 });

  const { error } = await admin.rpc("apply_paystack_payment", {
    p_reference: verified.data.data.reference,
    p_amount_minor: verified.data.data.amount,
    p_currency: verified.data.data.currency,
    p_provider_customer_id: payload.data.data.customer?.customer_code ?? null,
    p_provider_subscription_id: providerSubscriptionId ?? null,
  });
  if (error) return Response.json({ error: "Payment could not be recorded." }, { status: 503 });
  return Response.json({ received: true }, { status: 200 });
}
