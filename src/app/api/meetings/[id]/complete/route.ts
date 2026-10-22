import { z } from "zod";
import { AssemblyAISubmitResponseSchema } from "@/lib/schemas";
import { getFreePlanLimits } from "@/lib/billing-limits";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/origin";
import { InvalidMediaError, inspectUploadedMedia } from "@/lib/media/inspect-upload";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMeetingStoragePath } from "@/lib/storage-path";

const MeetingIdSchema = z.string().uuid();
const STORAGE_BUCKET = "meeting-audio";
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 60 * 60;
const RETRYABLE_FAILURES = new Set([
  "transcription_submit_failed",
  "transcription_submit_invalid",
  "transcription_submit_unrecorded",
  "usage_limit_reached",
  "usage_reservation_failed",
]);

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
    return Response.json({ error: "Meeting processing is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in before processing a meeting." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:process",
    userId: user.id,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const { data: meeting, error: meetingError } = await supabase.from("meetings")
    .select("id, status, failure_code, storage_path, size_bytes, source_type")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (meetingError) return Response.json({ error: "The meeting could not be loaded." }, { status: 503 });
  if (!meeting) return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (meeting.status === "processing") {
    return Response.json({ meetingId: id, status: "processing" }, { status: 202 });
  }
  if (meeting.status !== "uploading" && !(meeting.status === "failed" && RETRYABLE_FAILURES.has(meeting.failure_code ?? ""))) {
    return Response.json({ error: "This meeting cannot be queued for processing." }, { status: 409 });
  }

  if (!isMeetingStoragePath(user.id, id, meeting.storage_path)) {
    return Response.json({ error: "The uploaded file could not be verified." }, { status: 400 });
  }
  const storagePathParts = meeting.storage_path.split("/");
  const fileName = storagePathParts.pop();
  const folder = storagePathParts.join("/");
  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (!fileName || !folder || !extension || !Number.isSafeInteger(Number(meeting.size_bytes)) ||
      Number(meeting.size_bytes) < 1 || Number(meeting.size_bytes) > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "The uploaded file could not be verified." }, { status: 400 });
  }
  const { data: objects, error: listError } = await supabase.storage.from(STORAGE_BUCKET)
    .list(folder, { search: fileName, limit: 1 });
  const object = objects?.find((entry) => entry.name === fileName);
  if (listError || !object || Number(object.metadata?.size) !== Number(meeting.size_bytes)) {
    return Response.json({ error: "The uploaded file could not be verified." }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Meeting processing is not available yet." }, { status: 503 });
  }
  const { data: signedFile, error: signedUrlError } = await supabase.storage.from(STORAGE_BUCKET)
    .createSignedUrl(meeting.storage_path, 7200);
  if (signedUrlError || !signedFile?.signedUrl) {
    return Response.json({ error: "The uploaded file could not be prepared for transcription." }, { status: 503 });
  }

  let media: { durationSeconds: number };
  try {
    media = await inspectUploadedMedia(signedFile.signedUrl, extension);
  } catch (error) {
    await admin.from("meetings")
      .update({ status: "failed", failure_code: error instanceof InvalidMediaError ? "invalid_media" : "media_inspection_failed" })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error instanceof InvalidMediaError) {
      return Response.json({ error: "The uploaded file is not a supported audio or video file." }, { status: 400 });
    }
    return Response.json({ error: "The uploaded file could not be inspected. Please retry." }, { status: 503 });
  }
  if (media.durationSeconds > MAX_DURATION_SECONDS) {
    await admin.from("meetings").update({ status: "failed", failure_code: "duration_limit_exceeded" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Meetings cannot be longer than 60 minutes." }, { status: 400 });
  }

  const freePlanLimits = getFreePlanLimits();
  if (!freePlanLimits) return Response.json({ error: "Meeting usage limits are not configured." }, { status: 503 });
  const claim = await admin.from("meetings")
    .update({ status: "processing", failure_code: null })
    .eq("id", id)
    .eq("owner_id", user.id)
    .in("status", ["uploading", "failed"])
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) {
    return Response.json({ error: "This meeting is already being processed." }, { status: 409 });
  }

  const durationSeconds = Math.ceil(media.durationSeconds);
  const { data: reserved, error: reservationError } = await admin.rpc("reserve_meeting_audio_seconds", {
    p_meeting_id: id,
    p_duration_seconds: durationSeconds,
    p_max_audio_seconds: freePlanLimits.audioSeconds,
  });
  if (reservationError || typeof reserved !== "boolean") {
    await admin.from("meetings").update({ status: "failed", failure_code: "usage_reservation_failed" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Meeting usage could not be reserved. Please retry." }, { status: 503 });
  }
  if (!reserved) {
    await admin.from("meetings").update({ status: "failed", failure_code: "usage_limit_reached" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "This workspace has reached its 90-minute monthly audio limit." }, { status: 402 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const webhookSecret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !webhookSecret || !appUrl || appUrl.includes("your-")) {
    await admin.from("meetings").update({ status: "failed", failure_code: "transcription_submit_failed" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Transcription is not configured yet." }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: signedFile.signedUrl,
        speaker_labels: true,
        webhook_url: `${appUrl.replace(/\/$/, "")}/api/webhooks/assemblyai?meetingId=${id}`,
        webhook_auth_header_name: "x-minutemate-webhook-secret",
        webhook_auth_header_value: webhookSecret,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    await admin.from("meetings").update({ status: "failed", failure_code: "transcription_submit_failed" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Transcription could not be started. Please try again." }, { status: 503 });
  }
  if (!response.ok) {
    await admin.from("meetings").update({ status: "failed", failure_code: "transcription_submit_failed" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Transcription could not be started. Please try again." }, { status: 503 });
  }

  const job = AssemblyAISubmitResponseSchema.safeParse(await response.json().catch(() => null));
  if (!job.success) {
    await admin.from("meetings").update({ status: "failed", failure_code: "transcription_submit_invalid" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Transcription could not be started. Please try again." }, { status: 503 });
  }
  const { data: savedJob, error: saveError } = await admin.from("meetings")
    .update({ transcription_job_id: job.data.id })
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (saveError || !savedJob) {
    await admin.from("meetings").update({ status: "failed", failure_code: "transcription_submit_unrecorded" })
      .eq("id", id).eq("owner_id", user.id);
    return Response.json({ error: "Transcription could not be recorded. Please retry shortly." }, { status: 503 });
  }
  return Response.json({ meetingId: id, status: "processing" }, { status: 202 });
}
