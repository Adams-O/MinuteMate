import { z } from "zod";
import { WebhookEnvelopeSchema } from "@/lib/schemas";
import { readBoundedBodyText } from "@/lib/request-utils";
import { verifyAssemblyAIWebhookAuth } from "@/lib/meeting-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MeetingIdSchema = z.string().uuid();
const WEBHOOK_AUTH_HEADER = "x-minutemate-webhook-secret";
const MAX_WEBHOOK_BODY_BYTES = 8192;

export async function POST(request: Request) {
  const webhookSecret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  if (!verifyAssemblyAIWebhookAuth(request.headers.get(WEBHOOK_AUTH_HEADER), webhookSecret)) {
    return Response.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  const bodyText = await readBoundedBodyText(request, MAX_WEBHOOK_BODY_BYTES);
  if (bodyText === null) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const event = WebhookEnvelopeSchema.safeParse(payload);
  if (!event.success) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const meetingId = MeetingIdSchema.safeParse(new URL(request.url).searchParams.get("meetingId"));
  if (!meetingId.success) {
    return Response.json({ error: "Invalid webhook resource." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Webhook processing is unavailable." }, { status: 503 });
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id, status, transcription_job_id")
    .eq("id", meetingId.data)
    .maybeSingle();
  if (meetingError) {
    return Response.json({ error: "Webhook processing is unavailable." }, { status: 503 });
  }
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (!meeting.transcription_job_id) {
    return Response.json({ error: "Transcription job is not ready yet." }, { status: 503 });
  }
  if (meeting.transcription_job_id !== event.data.transcript_id) {
    return Response.json({ error: "Webhook resource did not match." }, { status: 400 });
  }
  if (meeting.status === "ready" || meeting.status === "failed") {
    return Response.json({ received: true }, { status: 200 });
  }
  if (meeting.status !== "processing") {
    return Response.json({ error: "Meeting is not processing." }, { status: 409 });
  }

  const { error: insertError } = await supabase.from("assemblyai_webhook_events").insert({
    meeting_id: meeting.id,
    transcription_job_id: event.data.transcript_id,
    event_status: event.data.status,
    state: "queued",
  });
  if (!insertError) {
    return Response.json({ received: true, queued: true }, { status: 202 });
  }
  if (insertError.code !== "23505") {
    return Response.json({ error: "Webhook event could not be queued." }, { status: 503 });
  }

  const { data: existingEvent, error: lookupError } = await supabase
    .from("assemblyai_webhook_events")
    .select("meeting_id, event_status")
    .eq("transcription_job_id", event.data.transcript_id)
    .maybeSingle();
  if (lookupError) {
    return Response.json({ error: "Webhook event could not be verified." }, { status: 503 });
  }
  if (
    !existingEvent ||
    existingEvent.meeting_id !== meeting.id ||
    existingEvent.event_status !== event.data.status
  ) {
    return Response.json({ error: "Webhook event did not match the queued transcription." }, { status: 400 });
  }

  return Response.json({ received: true, duplicate: true }, { status: 200 });
}
