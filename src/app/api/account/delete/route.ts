import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";
import { isMeetingStoragePath } from "@/lib/storage-path";

const DeleteAccountInputSchema = z.object({ confirmation: z.literal("DELETE") });
const MAX_BODY_BYTES = 1024;
const STORAGE_BUCKET = "meeting-audio";

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
  if (!DeleteAccountInputSchema.safeParse(body).success) {
    return Response.json({ error: "Type DELETE to confirm permanent account deletion." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Account deletion is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in before deleting your account." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "account:delete",
    userId: user.id,
    limit: 2,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Account deletion is not available yet." }, { status: 503 });
  }
  const { error: markError } = await admin.from("profiles")
    .update({ account_deletion_started_at: new Date().toISOString() })
    .eq("id", user.id);
  if (markError) {
    return Response.json({ error: "Account deletion could not be started." }, { status: 503 });
  }
  const { data: meetings, error: meetingError } = await supabase.from("meetings")
    .select("id, storage_path")
    .eq("owner_id", user.id);
  if (meetingError || !meetings) {
    return Response.json({ error: "Your recordings could not be prepared for deletion. Retry the request to continue." }, { status: 503 });
  }
  if (meetings.some(({ id, storage_path }) => !isMeetingStoragePath(user.id, id, storage_path))) {
    return Response.json({ error: "A recording could not be safely matched to your account." }, { status: 503 });
  }
  const paths = meetings.map(({ storage_path }) => storage_path);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(paths.slice(index, index + 100));
    if (error) {
      return Response.json({ error: "Some stored recordings could not be deleted. Retry account deletion." }, { status: 503 });
    }
  }

  const { error: transferError } = await admin.rpc("prepare_account_deletion", { p_user_id: user.id });
  if (transferError) {
    return Response.json({
      error: "Workspace ownership could not be transferred. Some recording files may already have been removed; retry account deletion.",
    }, { status: 503 });
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return Response.json({ error: "Your account could not be deleted. Retained recording files may already have been removed; retry or contact support." }, { status: 503 });
  }
  return Response.json({ deleted: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
