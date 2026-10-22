import "server-only";
import {
  AssemblyAIResultSchema,
  TranscriptSegmentSchema,
} from "@/lib/schemas";
import {
  InvalidMinutesOutputError,
  generateMinutesFromTranscript,
} from "@/lib/ai/generate-minutes";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readBoundedBodyText } from "@/lib/request-utils";
import { isMeetingStoragePath } from "@/lib/storage-path";

const STORAGE_BUCKET = "meeting-audio";
const MAX_ATTEMPTS = 5;
const MAX_DURATION_SECONDS = 60 * 60;
const MAX_TRANSCRIPTION_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TRANSCRIPT_TEXT_LENGTH = 1_000_000;

type WebhookEvent = {
  id: string;
  meeting_id: string;
  transcription_job_id: string;
  event_status: "completed" | "error";
  attempt_count: number;
};

type MeetingForProcessing = {
  id: string;
  owner_id: string;
  status: string;
  storage_path: string;
  audio_retention: "delete_after_transcription" | "keep";
  audio_deletion_status: string;
  transcription_job_id: string | null;
  duration_seconds: number | null;
};

export async function processNextAssemblyAIWebhook(): Promise<"processed" | "idle"> {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: queued, error: queuedError } = await admin
    .from("assemblyai_webhook_events")
    .select("id, meeting_id, transcription_job_id, event_status, attempt_count, locked_until, state")
    .eq("state", "queued")
    .lte("next_attempt_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (queuedError) {
    throw new Error("Webhook queue could not be read.");
  }

  let candidate = queued;
  if (!candidate) {
    const { data: expired, error: expiredError } = await admin
      .from("assemblyai_webhook_events")
      .select("id, meeting_id, transcription_job_id, event_status, attempt_count, locked_until, state")
      .eq("state", "processing")
      .lt("locked_until", nowIso)
      .order("locked_until", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (expiredError) {
      throw new Error("Webhook queue could not be read.");
    }
    candidate = expired;
  }

  if (!candidate) {
    return "idle";
  }

  const nextAttemptCount = candidate.attempt_count + 1;
  let claim = admin
    .from("assemblyai_webhook_events")
    .update({
      state: "processing",
      attempt_count: nextAttemptCount,
      locked_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      updated_at: nowIso,
    })
    .eq("id", candidate.id)
    .eq("state", candidate.state);

  if (candidate.state === "queued") {
    claim = claim.lte("next_attempt_at", nowIso);
  } else {
    claim = claim.eq("locked_until", candidate.locked_until);
  }

  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
  if (claimError) {
    throw new Error("Webhook event could not be claimed.");
  }
  if (!claimed) {
    return "idle";
  }

  const event: WebhookEvent = {
    id: candidate.id,
    meeting_id: candidate.meeting_id,
    transcription_job_id: candidate.transcription_job_id,
    event_status: candidate.event_status,
    attempt_count: nextAttemptCount,
  };

  try {
    await processWebhookEvent(event);
    const { error } = await admin
      .from("assemblyai_webhook_events")
      .update({ state: "done", locked_until: null, failure_code: null, updated_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("state", "processing");
    if (error) {
      throw new Error("Webhook completion could not be recorded.");
    }
  } catch (error) {
    if (error instanceof PermanentWebhookError) {
      await markMeetingFailed(event.meeting_id, error.failureCode);
      if (error.transcriptionSucceeded) {
        await applyAudioRetention(event.meeting_id);
      }
      const { error: updateError } = await admin
        .from("assemblyai_webhook_events")
        .update({
          state: "done",
          locked_until: null,
          failure_code: error.failureCode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id)
        .eq("state", "processing");
      if (updateError) {
        throw new Error("Webhook failure could not be recorded.");
      }
      return "processed";
    }

    if (event.attempt_count >= MAX_ATTEMPTS) {
      await markMeetingFailed(event.meeting_id, "webhook_processing_failed");
      const { error: updateError } = await admin
        .from("assemblyai_webhook_events")
        .update({
          state: "failed",
          locked_until: null,
          failure_code: "webhook_processing_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id)
        .eq("state", "processing");
      if (updateError) {
        throw new Error("Webhook failure could not be recorded.");
      }
      return "processed";
    }

    const delaySeconds = Math.min(30 * (2 ** (event.attempt_count - 1)), 3600);
    const { error: retryError } = await admin
      .from("assemblyai_webhook_events")
      .update({
        state: "queued",
        locked_until: null,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        failure_code: "processing_retry_scheduled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("state", "processing");
    if (retryError) {
      throw new Error("Webhook retry could not be scheduled.");
    }
  }

  return "processed";
}

async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: meeting, error: meetingError } = await admin
    .from("meetings")
    .select("id, owner_id, status, storage_path, audio_retention, audio_deletion_status, transcription_job_id, duration_seconds")
    .eq("id", event.meeting_id)
    .maybeSingle();

  if (meetingError) {
    throw new Error("Meeting could not be loaded.");
  }
  if (!meeting) {
    return;
  }
  const typedMeeting = meeting as MeetingForProcessing;
  if (!isMeetingStoragePath(typedMeeting.owner_id, typedMeeting.id, typedMeeting.storage_path)) {
    throw new PermanentWebhookError("invalid_meeting_storage_path");
  }
  if (typedMeeting.transcription_job_id !== event.transcription_job_id) {
    throw new PermanentWebhookError("webhook_resource_mismatch");
  }
  if (typedMeeting.status === "ready") {
    if (typedMeeting.audio_retention === "delete_after_transcription") {
      await applyAudioRetention(typedMeeting.id);
    }
    return;
  }
  if (typedMeeting.status === "failed") {
    if (
      typedMeeting.audio_retention === "delete_after_transcription" &&
      ["pending", "failed"].includes(typedMeeting.audio_deletion_status)
    ) {
      await applyAudioRetention(typedMeeting.id);
    }
    return;
  }
  if (typedMeeting.status !== "processing") {
    throw new PermanentWebhookError("meeting_not_processing");
  }
  if (event.event_status === "error") {
    throw new PermanentWebhookError("transcription_failed");
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("Transcription service is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.assemblyai.com/v2/transcript/${encodeURIComponent(event.transcription_job_id)}`,
      { headers: { authorization: apiKey }, signal: AbortSignal.timeout(20000) },
    );
  } catch {
    throw new Error("Transcription result is temporarily unavailable.");
  }
  if (!response.ok) {
    throw new Error("Transcription result is temporarily unavailable.");
  }

  const responseBody = await readBoundedBodyText(response, MAX_TRANSCRIPTION_RESPONSE_BYTES);
  let rawResult: unknown = null;
  try {
    rawResult = responseBody === null ? null : JSON.parse(responseBody);
  } catch {
    rawResult = null;
  }
  const result = AssemblyAIResultSchema.safeParse(rawResult);
  if (!result.success || result.data.id !== event.transcription_job_id) {
    throw new PermanentWebhookError("transcription_result_invalid");
  }
  if (result.data.status === "error") {
    throw new PermanentWebhookError("transcription_failed");
  }
  if (result.data.status !== "completed") {
    throw new Error("Transcription is not complete yet.");
  }

  const durationSeconds = result.data.audio_duration ?? typedMeeting.duration_seconds;
  if (typeof durationSeconds !== "number" || durationSeconds <= 0) {
    throw new PermanentWebhookError("transcription_duration_missing", true);
  }
  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new PermanentWebhookError("duration_limit_exceeded", true);
  }

  const transcriptText = result.data.text?.trim() ?? "";
  const utteranceTextLength = (result.data.utterances ?? []).reduce(
    (total, utterance) => total + utterance.text.length,
    0,
  );
  if (!transcriptText) {
    throw new PermanentWebhookError("empty_transcript", true);
  }
  if (utteranceTextLength > MAX_TRANSCRIPT_TEXT_LENGTH) {
    throw new PermanentWebhookError("transcript_limit_exceeded", true);
  }

  const rawSegments = (result.data.utterances ?? []).map((utterance) => ({
    start: utterance.start / 1000,
    end: utterance.end / 1000,
    speaker: utterance.speaker ?? null,
    text: utterance.text,
  }));
  const segments = rawSegments.length
    ? rawSegments
    : [{
        start: 0,
        end: durationSeconds,
        speaker: null,
        text: transcriptText,
      }];
  const validatedSegments = segments.map((segment) => TranscriptSegmentSchema.safeParse(segment));
  if (validatedSegments.some((segment) => !segment.success)) {
    throw new PermanentWebhookError("transcription_segments_invalid", true);
  }

  let minutes;
  try {
    minutes = await generateMinutesFromTranscript(transcriptText);
  } catch (error) {
    if (error instanceof InvalidMinutesOutputError) {
      throw new PermanentWebhookError("minutes_generation_failed", true);
    }
    throw error;
  }

  const { error: saveError } = await admin.rpc("complete_meeting_processing", {
    p_meeting_id: typedMeeting.id,
    p_segments: validatedSegments.map((segment) => segment.data),
    p_language: result.data.language_code ?? null,
    p_summary: minutes.summary,
    p_key_points: minutes.key_points,
    p_decisions: minutes.decisions,
    p_action_items: minutes.action_items,
    p_duration_seconds: Math.ceil(durationSeconds),
  });
  if (saveError) {
    throw new Error("Meeting results could not be saved.");
  }

  await applyAudioRetention(typedMeeting.id);
}

async function applyAudioRetention(meetingId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: meeting, error: loadError } = await admin
    .from("meetings")
    .select("id, owner_id, storage_path, audio_retention")
    .eq("id", meetingId)
    .maybeSingle();
  if (loadError) {
    throw new Error("Audio retention state could not be loaded.");
  }
  if (!meeting || meeting.audio_retention === "keep") {
    return;
  }
  if (!isMeetingStoragePath(meeting.owner_id, meetingId, meeting.storage_path)) {
    throw new Error("Meeting audio could not be safely matched to its owner.");
  }

  const { error: pendingError } = await admin
    .from("meetings")
    .update({ audio_deletion_status: "pending" })
    .eq("id", meetingId);
  if (pendingError) {
    throw new Error("Audio deletion could not be scheduled.");
  }

  const { error: deleteError } = await admin.storage
    .from(STORAGE_BUCKET)
    .remove([meeting.storage_path]);
  const { error: outcomeError } = await admin
    .from("meetings")
    .update({
      audio_deletion_status: deleteError ? "failed" : "deleted",
      audio_deleted_at: deleteError ? null : new Date().toISOString(),
    })
    .eq("id", meetingId);
  if (outcomeError) {
    throw new Error("Audio deletion outcome could not be recorded.");
  }
  if (deleteError) {
    throw new Error("Audio deletion failed and has been scheduled for retry.");
  }
}

async function markMeetingFailed(meetingId: string, failureCode: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("meetings")
    .update({ status: "failed", failure_code: failureCode })
    .eq("id", meetingId)
    .eq("status", "processing");
  if (error) {
    throw new Error("Meeting processing failure could not be recorded.");
  }
}

class PermanentWebhookError extends Error {
  constructor(
    readonly failureCode: string,
    readonly transcriptionSucceeded = false,
  ) {
    super(failureCode);
  }
}
