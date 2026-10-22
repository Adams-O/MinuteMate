import { randomBytes, createHash } from "node:crypto";
import { Resend } from "resend";
import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const WorkspaceIdSchema = z.string().uuid();
const InvitationInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["admin", "member"]).default("member"),
});
const SenderSchema = z.string().trim().email().max(254);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  if (!WorkspaceIdSchema.safeParse(id).success) return Response.json({ error: "Workspace not found." }, { status: 404 });
  const bodyText = await readBoundedBodyText(request, 2048);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = InvitationInputSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Invitation details are invalid." }, { status: 400 });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Invitations are not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to invite a workspace member." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "workspace:invite",
    userId: user.id,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) return Response.json({ error: "Workspace membership could not be checked." }, { status: 503 });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return Response.json({ error: "Only workspace owners and admins can invite members." }, { status: 403 });
  }
  if (input.data.role === "admin" && membership.role !== "owner") {
    return Response.json({ error: "Only workspace owners can invite administrators." }, { status: 403 });
  }
  if (user.email?.toLowerCase() === input.data.email.toLowerCase()) {
    return Response.json({ error: "You are already a member of this workspace." }, { status: 409 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const apiKey = process.env.RESEND_API_KEY;
  const sender = SenderSchema.safeParse(process.env.RESEND_FROM_EMAIL);
  if (!appUrl || appUrl.includes("your-") || !apiKey || !sender.success) {
    return Response.json({ error: "Workspace invitation email is not configured." }, { status: 503 });
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Invitations are not available yet." }, { status: 503 });
  }
  const { data: invitation, error: insertError } = await admin
    .from("workspace_invitations")
    .insert({
      workspace_id: id,
      email: input.data.email.toLowerCase(),
      role: input.data.role,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insertError) {
    return Response.json({
      error: insertError.code === "23505"
        ? "An active invitation may already exist for that email."
        : "The invitation could not be created.",
    }, { status: insertError.code === "23505" ? 409 : 503 });
  }

  try {
    const invitationUrl = new URL("/invitations/accept", appUrl);
    invitationUrl.hash = token;
    const { error } = await new Resend(apiKey).emails.send({
      from: sender.data,
      to: input.data.email,
      subject: "You are invited to a MinuteMate workspace",
      text: `You have been invited to join a MinuteMate workspace as ${input.data.role}. Sign in with this email and accept the invitation within 7 days: ${invitationUrl.toString()}`,
    });
    if (error) throw new Error("Invitation email delivery failed.");
  } catch {
    const { error: revokeError } = await admin.from("workspace_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitation.id);
    return Response.json({
      error: revokeError
        ? "Invitation email failed and the invitation could not be invalidated. Contact support."
        : "The invitation email could not be delivered.",
    }, { status: revokeError ? 503 : 502 });
  }

  return Response.json({ invited: true }, { status: 201 });
}
