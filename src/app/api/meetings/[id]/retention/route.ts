import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { isMeetingStoragePath } from "@/lib/storage-path";

const MeetingIdSchema = z.string().uuid();
const STORAGE_BUCKET = "meeting-audio";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Audio retention is not available yet." }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Sign in before changing audio retention." }, { status: 401 });
  }
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:retention",
    userId: user.id,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id, storage_path, audio_retention, audio_deletion_status")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (meetingError) {
    return Response.json({ error: "The meeting could not be loaded." }, { status: 500 });
  }
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (!isMeetingStoragePath(user.id, id, meeting.storage_path)) {
    return Response.json({ error: "Meeting audio could not be safely matched to this account." }, { status: 503 });
  }
  if (meeting.audio_retention === "keep") {
    return Response.json({ error: "This meeting is set to retain its source audio." }, { status: 409 });
  }
  if (meeting.audio_deletion_status === "deleted") {
    return Response.json({ audioDeletionStatus: "deleted" }, { status: 200 });
  }
  if (!["pending", "failed"].includes(meeting.audio_deletion_status)) {
    return Response.json({ error: "Source audio is not ready to be deleted." }, { status: 409 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Audio deletion is not available yet." }, { status: 503 });
  }

  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([meeting.storage_path]);
  const { error: updateError } = await admin
    .from("meetings")
    .update({
      audio_deletion_status: storageError ? "failed" : "deleted",
      audio_deleted_at: storageError ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (updateError) {
    return Response.json({ error: "Audio deletion outcome could not be recorded." }, { status: 503 });
  }
  if (storageError) {
    return Response.json({ error: "Source audio could not be deleted. Please retry." }, { status: 503 });
  }

  return Response.json({ audioDeletionStatus: "deleted" }, { status: 200 });
}
