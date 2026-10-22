import "server-only";
import { z } from "zod";
import { ActionItemRecordSchema, MinutesRecordSchema } from "@/lib/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MeetingHeaderSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  status: z.enum(["uploading", "processing", "ready", "failed"]),
});

const MeetingContentSchema = z.object({
  meeting: MeetingHeaderSchema,
  minutes: MinutesRecordSchema,
  actionItems: z.array(ActionItemRecordSchema),
});

export type MeetingContent = z.infer<typeof MeetingContentSchema>;
export type MeetingContentResult =
  | { kind: "unauthenticated" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "not_ready" }
  | { kind: "ready"; content: MeetingContent; userId: string };

export async function getOwnedMeetingContent(meetingId: string): Promise<MeetingContentResult> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { kind: "unavailable" };
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { kind: "unauthenticated" };

  const { data: meetingRow, error: meetingError } = await supabase
    .from("meetings")
    .select("id, title, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (meetingError) return { kind: "unavailable" };
  if (!meetingRow) return { kind: "not_found" };
  const meeting = MeetingHeaderSchema.safeParse(meetingRow);
  if (!meeting.success) return { kind: "unavailable" };
  if (meeting.data.status !== "ready") return { kind: "not_ready" };

  const [minutesResult, actionItemsResult] = await Promise.all([
    supabase.from("minutes").select("summary, key_points, decisions").eq("meeting_id", meetingId).maybeSingle(),
    supabase.from("action_items").select("id, task, owner, deadline, priority, status")
      .eq("meeting_id", meetingId).order("created_at"),
  ]);
  if (minutesResult.error || actionItemsResult.error || !minutesResult.data) {
    return { kind: "unavailable" };
  }
  const content = MeetingContentSchema.safeParse({
    meeting: meeting.data,
    minutes: minutesResult.data,
    actionItems: actionItemsResult.data ?? [],
  });
  return content.success ? { kind: "ready", content: content.data, userId: user.id } : { kind: "unavailable" };
}
