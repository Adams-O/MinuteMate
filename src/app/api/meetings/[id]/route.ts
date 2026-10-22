import { z } from "zod";
import { UpdateMeetingInputSchema, TranscriptSegmentSchema } from "@/lib/schemas";
import { readBoundedBodyText } from "@/lib/request-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { isMeetingStoragePath } from "@/lib/storage-path";

const MeetingIdSchema = z.string().uuid();
const STORAGE_BUCKET = "meeting-audio";
const MAX_BODY_BYTES = 32 * 1024;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = UpdateMeetingInputSchema.safeParse(body);
  if (!input.success) {
    return Response.json({ error: "Meeting changes are invalid." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Meeting editing is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Sign in before editing a meeting." }, { status: 401 });
  }
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:edit",
    userId: user.id,
    limit: 60,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Meeting editing is not available yet." }, { status: 503 });
  }
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id, owner_id, status, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (meetingError) {
    return Response.json({ error: "The meeting could not be loaded." }, { status: 500 });
  }
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (!isMeetingStoragePath(meeting.owner_id, id, meeting.storage_path)) {
    return Response.json({ error: "Meeting audio could not be safely matched to this account." }, { status: 503 });
  }
  if (meeting.status !== "ready") {
    return Response.json({ error: "Only completed meetings can be edited." }, { status: 409 });
  }

  if (input.data.type === "title") {
    const { data, error } = await admin.from("meetings").update({ title: input.data.title })
      .eq("id", id).select("id").maybeSingle();
    if (error) return Response.json({ error: "The meeting title could not be saved." }, { status: 500 });
    if (!data) return Response.json({ error: "Meeting not found." }, { status: 404 });
  } else if (input.data.type === "minutes") {
    const { data, error } = await admin.from("minutes").update({
      summary: input.data.summary,
      key_points: input.data.key_points,
      decisions: input.data.decisions,
      updated_at: new Date().toISOString(),
    }).eq("meeting_id", id).select("meeting_id").maybeSingle();
    if (error) return Response.json({ error: "Meeting minutes could not be saved." }, { status: 500 });
    if (!data) return Response.json({ error: "Meeting minutes not found." }, { status: 404 });
  } else if (input.data.type === "action_item") {
    const { data, error } = await admin.from("action_items").update({
      task: input.data.task,
      owner: input.data.owner,
      deadline: input.data.deadline,
      priority: input.data.priority,
      status: input.data.status,
      updated_at: new Date().toISOString(),
    }).eq("id", input.data.actionItemId).eq("meeting_id", id).select("id").maybeSingle();
    if (error) return Response.json({ error: "The action item could not be saved." }, { status: 500 });
    if (!data) return Response.json({ error: "Action item not found." }, { status: 404 });
  } else if (input.data.type === "speaker") {
    const { currentLabel, newLabel } = input.data;
    const { data: transcript, error: transcriptError } = await admin
      .from("transcripts").select("segments").eq("meeting_id", id).maybeSingle();
    if (transcriptError) {
      return Response.json({ error: "The transcript could not be loaded." }, { status: 500 });
    }
    if (!transcript) return Response.json({ error: "Transcript not found." }, { status: 404 });

    const segments = z.array(TranscriptSegmentSchema).safeParse(transcript.segments);
    if (!segments.success) return Response.json({ error: "Transcript data is unavailable." }, { status: 500 });
    const matchingSegments = segments.data.filter((segment) => segment.speaker === currentLabel);
    if (matchingSegments.length === 0) {
      return Response.json({ error: "Speaker label not found." }, { status: 404 });
    }
    if (currentLabel !== newLabel && segments.data.some((segment) => segment.speaker === newLabel)) {
      return Response.json({ error: "That speaker label is already in use." }, { status: 409 });
    }
    const renamedSegments = segments.data.map((segment) => (
      segment.speaker === currentLabel
        ? { ...segment, speaker: newLabel }
        : segment
    ));
    const { data, error } = await admin.from("transcripts").update({
      segments: renamedSegments,
      updated_at: new Date().toISOString(),
    }).eq("meeting_id", id).select("meeting_id").maybeSingle();
    if (error) return Response.json({ error: "Speaker name could not be saved." }, { status: 500 });
    if (!data) return Response.json({ error: "Transcript not found." }, { status: 404 });
  }

  return Response.json({ saved: true }, { status: 200 });
}

export async function DELETE(
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
    return Response.json({ error: "Meeting deletion is not available yet." }, { status: 503 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Sign in before deleting a meeting." }, { status: 401 });
  }
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:delete",
    userId: user.id,
    limit: 20,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id, owner_id, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (meetingError) {
    return Response.json({ error: "The meeting could not be loaded." }, { status: 500 });
  }
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (!isMeetingStoragePath(meeting.owner_id, id, meeting.storage_path)) {
    return Response.json({ error: "Meeting audio could not be safely matched to this account." }, { status: 503 });
  }

  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([meeting.storage_path]);
  if (storageError) {
    return Response.json({ error: "Meeting audio could not be deleted. Please retry." }, { status: 503 });
  }

  const { error: deleteError } = await supabase
    .from("meetings")
    .delete()
    .eq("id", id);
  if (deleteError) {
    return Response.json({ error: "Meeting data could not be deleted. Please retry." }, { status: 503 });
  }

  return new Response(null, { status: 204 });
}
