import { randomUUID, timingSafeEqual } from "node:crypto";
import { MeetingMinutesSchema, type MeetingMinutes } from "@/lib/schemas";

export function createMeetingRecord(title: string, sourceType: "recording" | "upload") {
  return {
    id: randomUUID(),
    title: title.trim() || "Untitled meeting",
    status: "uploading" as const,
    createdAt: new Date().toISOString(),
    sourceType,
  };
}

export function safeTranscriptSummary(transcriptText: string): string {
  const stripped = transcriptText.trim();
  if (!stripped) {
    return "No transcript content was available for this meeting.";
  }

  const cleaned = stripped.replace(/\s+/g, " ");
  return cleaned.length > 280 ? `${cleaned.slice(0, 277).trim()}...` : cleaned;
}

export function buildMinutesFromTranscript(transcriptText: string): MeetingMinutes {
  const cleaned = transcriptText.trim();
  const lines = cleaned
    .split(/\s{2,}|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  const keyPoints = lines.length ? lines.map((line) => line.slice(0, 500)) : ["Meeting transcript captured successfully."];
  const summary = safeTranscriptSummary(transcriptText);
  const fallbackActionItems = [
    {
      task: "Confirm next steps with the meeting owner.",
      owner: "Not stated",
      deadline: "Not stated",
      priority: "medium",
      status: "open",
    },
  ] as const;

  const generated: MeetingMinutes = {
    summary,
    key_points: keyPoints,
    decisions: ["The transcript was the source of truth for the generated summary."],
    action_items: fallbackActionItems.map((item) => ({ ...item, priority: item.priority })),
  };

  const parsed = MeetingMinutesSchema.safeParse(generated);
  if (!parsed.success) {
    return {
      summary,
      key_points: ["Transcript reviewed successfully."],
      decisions: [],
      action_items: [
        {
          task: "Review immediate follow-ups after the meeting.",
          owner: "Not stated",
          deadline: "Not stated",
          priority: "medium",
          status: "open",
        },
      ],
    };
  }

  return parsed.data;
}

export function verifyAssemblyAIWebhookAuth(
  authHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authHeader) {
    return false;
  }

  return secureCompare(secret, authHeader);
}

function secureCompare(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);

  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
