import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { z as Zod } from "zod";
import { SharedMeetingContentSchema } from "@/lib/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export type ShareContent = Zod.infer<typeof SharedMeetingContentSchema>;
export type ShareResolution =
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "not_found" }
  | { kind: "ready"; content: ShareContent; expiresAt: string };

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function resolveShareToken(token: string): Promise<ShareResolution> {
  if (!ShareTokenSchema.safeParse(token).success) return { kind: "invalid" };
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { kind: "unavailable" };
  }

  const { data: share, error: shareError } = await admin
    .from("meeting_shares")
    .select("id, meeting_id, expires_at")
    .eq("token_hash", hashShareToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (shareError) return { kind: "unavailable" };
  if (!share) return { kind: "not_found" };

  const { data: meeting, error: meetingError } = await admin
    .from("meetings")
    .select("title, status, minutes(summary, key_points, decisions), action_items(id, task, owner, deadline, priority, status)")
    .eq("id", share.meeting_id)
    .maybeSingle();
  if (meetingError) return { kind: "unavailable" };
  if (!meeting || meeting.status !== "ready") return { kind: "not_found" };
  const content = SharedMeetingContentSchema.safeParse({
    title: meeting.title,
    minutes: Array.isArray(meeting.minutes) ? meeting.minutes[0] : meeting.minutes,
    actionItems: meeting.action_items,
  });
  if (!content.success) return { kind: "unavailable" };
  return { kind: "ready", content: content.data, expiresAt: share.expires_at };
}
