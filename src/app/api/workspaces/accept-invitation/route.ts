import { createHash } from "node:crypto";
import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";
import { enforceUserRateLimit } from "@/lib/rate-limit";

const AcceptInvitationSchema = z.object({
  token: z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const bodyText = await readBoundedBodyText(request, 1024);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = AcceptInvitationSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Invitation is invalid or expired." }, { status: 400 });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Invitations are not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in with the invited email address." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "workspace:accept-invitation",
    userId: user.id,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;
  if (!user.email || !user.email_confirmed_at) {
    return Response.json({ error: "Confirm the invited email address before accepting." }, { status: 403 });
  }

  const tokenHash = createHash("sha256").update(input.data.token).digest("hex");
  const { data, error } = await supabase.rpc("accept_workspace_invitation", { p_token_hash: tokenHash });
  if (error) return Response.json({ error: "Invitation is invalid, expired, or belongs to another email." }, { status: 400 });
  return Response.json({ workspaceId: data }, { status: 200 });
}
