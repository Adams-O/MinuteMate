import { z } from "zod";

export const MeetingSourceSchema = z.enum(["recording", "upload"]);
export const MeetingStatusSchema = z.enum([
  "uploading",
  "processing",
  "ready",
  "failed",
]);

export const MeetingRecordSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: MeetingStatusSchema,
  created_at: z.string(),
  duration_seconds: z.number().nullable(),
  failure_code: z.string().nullable(),
  audio_retention: z.enum(["delete_after_transcription", "keep"]),
  audio_deletion_status: z.enum(["not_requested", "pending", "deleted", "failed"]),
});

export const CreateMeetingInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  workspaceId: z.string().uuid().optional(),
  sourceType: MeetingSourceSchema.default("upload"),
  consent: z.boolean().default(false),
  audioRetention: z.enum(["delete_after_transcription", "keep"]).default("delete_after_transcription"),
  durationSeconds: z.number().int().nonnegative().max(3600).optional(),
  fileName: z.string().trim().max(200).optional(),
  mimeType: z.string().trim().max(100).optional(),
  sizeBytes: z.number().int().nonnegative().max(100 * 1024 * 1024).optional(),
}).superRefine((input, context) => {
  if (input.sourceType === "recording" && !input.consent) {
    context.addIssue({
      code: "custom",
      path: ["consent"],
      message: "Recording requires explicit consent.",
    });
  }
});

export const TranscriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  speaker: z.string().min(1).max(80).nullable().optional(),
  text: z.string().min(1).max(20000),
}).refine((segment) => segment.end >= segment.start);

export const TranscriptRecordSchema = z.object({
  segments: z.array(TranscriptSegmentSchema),
  language: z.string().nullable(),
});

export const ActionItemSchema = z.object({
  task: z.string().trim().min(1).max(500),
  owner: z.string().trim().default("Not stated").transform((value) => value || "Not stated"),
  deadline: z.string().trim().default("Not stated").transform((value) => value || "Not stated"),
  priority: z.enum(["low", "medium", "high", "Not stated"]).nullable().optional(),
  status: z.enum(["open", "in_progress", "done"]).default("open"),
});

export const ActionItemRecordSchema = ActionItemSchema.extend({
  id: z.string().uuid(),
});

export const MeetingMinutesSchema = z.object({
  summary: z.string().min(1).max(4000),
  key_points: z.array(z.string().max(500)).min(1).max(20),
  decisions: z.array(z.string().max(500)).default([]),
  action_items: z.array(ActionItemSchema).default([]),
});

export const MinutesRecordSchema = MeetingMinutesSchema.omit({ action_items: true });

export const WebhookEnvelopeSchema = z.object({
  transcript_id: z.string().min(1).max(200),
  status: z.enum(["completed", "error"]),
});

export const AssemblyAIResultSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["completed", "error"]),
  text: z.string().max(1000000).nullable().optional(),
  audio_duration: z.number().nonnegative().nullable().optional(),
  language_code: z.string().max(20).nullable().optional(),
  utterances: z.array(z.object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    speaker: z.string().max(80).nullable().optional(),
    text: z.string().min(1).max(20000),
  })).max(10000).optional(),
});

export const AssemblyAISubmitResponseSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["queued", "processing"]).optional(),
});

export const UpdateMeetingInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("title"),
    title: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("minutes"),
    summary: z.string().trim().min(1).max(4000),
    key_points: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    decisions: z.array(z.string().trim().min(1).max(500)).max(20),
  }),
  z.object({
    type: z.literal("action_item"),
    actionItemId: z.string().uuid(),
    task: z.string().trim().min(1).max(500),
    owner: z.string().trim().min(1).max(200),
    deadline: z.string().trim().min(1).max(200),
    priority: z.enum(["low", "medium", "high", "Not stated"]).nullable(),
    status: z.enum(["open", "in_progress", "done"]),
  }),
  z.object({
    type: z.literal("speaker"),
    currentLabel: z.string().trim().min(1).max(80),
    newLabel: z.string().trim().min(1).max(80),
  }),
]);

export const EmailMinutesInputSchema = z.object({
  confirmed: z.literal(true),
  recipients: z.array(z.email().max(254)).min(1).max(20),
}).superRefine((input, context) => {
  if (new Set(input.recipients.map((email) => email.toLowerCase())).size !== input.recipients.length) {
    context.addIssue({ code: "custom", path: ["recipients"], message: "Recipient addresses must be unique." });
  }
});

export const CreateShareInputSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720),
});

export const SharedMeetingContentSchema = z.object({
  title: z.string().min(1).max(200),
  minutes: MinutesRecordSchema,
  actionItems: z.array(ActionItemRecordSchema),
});

export type CreateMeetingInput = z.infer<typeof CreateMeetingInputSchema>;
export type MeetingMinutes = z.infer<typeof MeetingMinutesSchema>;
