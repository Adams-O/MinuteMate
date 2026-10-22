import { Resend } from "resend";
import { z } from "zod";
import { EmailMinutesInputSchema } from "@/lib/schemas";
import { readBoundedBodyText } from "@/lib/request-utils";
import { getOwnedMeetingContent } from "@/lib/meeting-content";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/origin";

const MeetingIdSchema = z.string().uuid();
const SenderSchema = z.string().trim().email().max(254);
const MAX_BODY_BYTES = 8 * 1024;

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
  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = EmailMinutesInputSchema.safeParse(body);
  if (!input.success) {
    return Response.json({ error: "Confirm the email and provide up to 20 unique, valid addresses." }, { status: 400 });
  }

  const result = await getOwnedMeetingContent(id);
  if (result.kind === "unauthenticated") return Response.json({ error: "Sign in to email these minutes." }, { status: 401 });
  if (result.kind === "not_found") return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (result.kind === "not_ready") return Response.json({ error: "Only completed meeting minutes can be emailed." }, { status: 409 });
  if (result.kind === "unavailable") return Response.json({ error: "Meeting data could not be loaded." }, { status: 503 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:email",
    userId: result.userId,
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const apiKey = process.env.RESEND_API_KEY;
  const sender = SenderSchema.safeParse(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !sender.success) {
    return Response.json({ error: "Email delivery is not configured." }, { status: 503 });
  }

  const { meeting, minutes, actionItems } = result.content;
  const text = [
    meeting.title,
    "",
    "Summary",
    minutes.summary,
    "",
    "Key points",
    ...minutes.key_points.map((point) => `- ${point}`),
    "",
    "Decisions",
    ...(minutes.decisions.length ? minutes.decisions.map((decision) => `- ${decision}`) : ["No decisions recorded."]),
    "",
    "Action items",
    ...(actionItems.length
      ? actionItems.map((item) => (
          `- ${item.task} (Owner: ${item.owner}; Deadline: ${item.deadline}; Priority: ${item.priority ?? "Not stated"}; Status: ${item.status.replace("_", " ")})`
        ))
      : ["No action items recorded."]),
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: sender.data,
      to: input.data.recipients[0],
      ...(input.data.recipients.length > 1 ? { bcc: input.data.recipients.slice(1) } : {}),
      subject: `Meeting minutes: ${meeting.title}`,
      text,
    });
    if (error) {
      return Response.json({ error: "The email could not be delivered. Please retry." }, { status: 502 });
    }
  } catch {
    return Response.json({ error: "The email could not be delivered. Please retry." }, { status: 502 });
  }

  return Response.json({ sent: true, recipientCount: input.data.recipients.length }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
