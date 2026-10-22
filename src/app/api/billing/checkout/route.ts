import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";

const CheckoutSchema = z.object({ workspaceId: z.string().uuid() });
const MAX_BODY_BYTES = 2048;

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = CheckoutSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Billing details are invalid." }, { status: 400 });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Billing is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in before upgrading a workspace." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "billing:checkout",
    userId: user.id,
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;
  if (!user.email || !user.email_confirmed_at) {
    return Response.json({ error: "Confirm your email address before upgrading." }, { status: 403 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", input.data.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) return Response.json({ error: "Workspace membership could not be checked." }, { status: 503 });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return Response.json({ error: "Only workspace owners and admins can manage billing." }, { status: 403 });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  const planCode = process.env.PAYSTACK_PLAN_CODE;
  const amountMinor = Number(process.env.PAYSTACK_AMOUNT_MINOR);
  const currency = process.env.PAYSTACK_CURRENCY ?? "NGN";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let currencySupported = false;
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      new Intl.NumberFormat("en", { style: "currency", currency });
      currencySupported = true;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (
    !secret || !planCode || !appUrl || appUrl.includes("your-") ||
    !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
    !currencySupported
  ) {
    return Response.json({ error: "Paystack billing is not configured." }, { status: 503 });
  }
  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        plan: planCode,
        callback_url: new URL("/billing", appUrl).toString(),
        metadata: { workspaceId: input.data.workspaceId },
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return Response.json({ error: "Checkout could not be started. Please retry." }, { status: 502 });
  }
  const rawResponse: unknown = await providerResponse.json().catch(() => null);
  const checkout = z.object({
    status: z.literal(true),
    data: z.object({
      authorization_url: z.string().url(),
      reference: z.string().min(1).max(200),
    }),
  }).safeParse(rawResponse);
  if (!providerResponse.ok || !checkout.success) {
    return Response.json({ error: "Paystack could not initialize checkout." }, { status: 502 });
  }
  const authorizationUrl = new URL(checkout.data.data.authorization_url);
  if (authorizationUrl.protocol !== "https:" || authorizationUrl.hostname !== "checkout.paystack.com") {
    return Response.json({ error: "Paystack returned an invalid checkout destination." }, { status: 502 });
  }
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Billing is not available yet." }, { status: 503 });
  }
  const { error: intentError } = await admin.from("billing_transactions").insert({
    reference: checkout.data.data.reference,
    workspace_id: input.data.workspaceId,
    amount_minor: amountMinor,
    currency,
    status: "pending",
    created_by: user.id,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (intentError) return Response.json({ error: "Checkout could not be recorded. Please start a new checkout." }, { status: 503 });

  return Response.json({ authorizationUrl: authorizationUrl.toString() }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
