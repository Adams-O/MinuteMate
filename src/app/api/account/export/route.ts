import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { ActionItemRecordSchema, MeetingStatusSchema, MeetingSourceSchema, TranscriptSegmentSchema } from "@/lib/schemas";
import { isMeetingStoragePath } from "@/lib/storage-path";

const ExportMeetingsSchema = z.array(z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  status: MeetingStatusSchema,
  source_type: MeetingSourceSchema,
  storage_path: z.string(),
  audio_retention: z.string(),
  audio_deletion_status: z.string(),
  size_bytes: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  workspace_id: z.string().uuid(),
  created_at: z.string(),
})).max(5000);
const ExportWorkspacesSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  created_at: z.string(),
}));
const ExportMembershipsSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]),
  created_at: z.string(),
}));
const ExportSubscriptionsSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  provider: z.string(),
  plan: z.string(),
  status: z.string(),
  currency: z.string().nullable(),
  amount_minor: z.number().nullable(),
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
}));
const ExportUsageSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  meeting_id: z.string().uuid().nullable(),
  event_type: z.string(),
  quantity: z.number(),
  unit: z.string(),
  period_start: z.string(),
  created_at: z.string(),
}));
const ExportInvitationsSchema = z.array(z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
}));
const ExportTranscriptsSchema = z.array(z.object({
  meeting_id: z.string().uuid(),
  segments: z.array(TranscriptSegmentSchema),
  language: z.string().nullable(),
  created_at: z.string(),
}));
const ExportMinutesSchema = z.array(z.object({
  meeting_id: z.string().uuid(),
  summary: z.string(),
  key_points: z.array(z.string()),
  decisions: z.array(z.string()),
  created_at: z.string(),
}));
const ExportActionItemsSchema = z.array(ActionItemRecordSchema.extend({
  meeting_id: z.string().uuid(),
  created_at: z.string(),
}));
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const PAGE_SIZE = 500;
const MAX_AUXILIARY_ROWS = 10_000;

async function readAllRows(
  readPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown | null }>,
) {
  const rows: unknown[] = [];
  for (let from = 0; from <= MAX_AUXILIARY_ROWS; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error, tooLarge: false };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { rows, error: null, tooLarge: false };
  }
  return { rows, error: null, tooLarge: rows.length > MAX_AUXILIARY_ROWS };
}

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Data export is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to export your data." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "account:export",
    userId: user.id,
    limit: 2,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const profileResult = await supabase.from("profiles").select("display_name, created_at").eq("id", user.id).maybeSingle();
  const workspaceRows = await readAllRows((from, to) => supabase.from("workspaces")
    .select("id, name, created_at")
    .order("created_at", { ascending: true })
    .range(from, to));
  if (profileResult.error || workspaceRows.error || workspaceRows.tooLarge) {
    return Response.json({ error: "Your account data could not be loaded." }, { status: 503 });
  }
  const workspaces = ExportWorkspacesSchema.safeParse(workspaceRows.rows);
  const profile = z.object({
    display_name: z.string().nullable(),
    created_at: z.string(),
  }).nullable().safeParse(profileResult.data);
  if (!workspaces.success || !profile.success) {
    return Response.json({ error: "Your account data is unavailable for export." }, { status: 503 });
  }

  const meetingRows: unknown[] = [];
  for (let from = 0; from <= 5000; from += PAGE_SIZE) {
    const { data, error } = await supabase.from("meetings")
      .select("id, owner_id, title, status, source_type, storage_path, audio_retention, audio_deletion_status, size_bytes, duration_seconds, workspace_id, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return Response.json({ error: "Your meetings could not be loaded for export." }, { status: 503 });
    meetingRows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const meetings = ExportMeetingsSchema.safeParse(meetingRows);
  if (!meetings.success || meetings.data.some((meeting) =>
    !isMeetingStoragePath(meeting.owner_id, meeting.id, meeting.storage_path)
  )) {
    return Response.json({ error: "Your export is too large to prepare in one file." }, { status: 413 });
  }
  const meetingIds = meetings.data.map(({ id }) => id);
  const transcripts: unknown[] = [];
  const minutes: unknown[] = [];
  const actionItems: unknown[] = [];
  for (let from = 0; from < meetingIds.length; from += PAGE_SIZE) {
    const batch = meetingIds.slice(from, from + PAGE_SIZE);
    const [transcriptsResult, minutesResult, itemsResult] = await Promise.all([
      supabase.from("transcripts").select("meeting_id, segments, language, created_at").in("meeting_id", batch),
      supabase.from("minutes").select("meeting_id, summary, key_points, decisions, created_at").in("meeting_id", batch),
      supabase.from("action_items").select("id, meeting_id, task, owner, deadline, priority, status, created_at").in("meeting_id", batch),
    ]);
    if (transcriptsResult.error || minutesResult.error || itemsResult.error) {
      return Response.json({ error: "Meeting content could not be loaded for export." }, { status: 503 });
    }
    transcripts.push(...(transcriptsResult.data ?? []));
    minutes.push(...(minutesResult.data ?? []));
    actionItems.push(...(itemsResult.data ?? []));
  }
  const [membershipRows, subscriptionRows, usageRows, invitationRows] = await Promise.all([
    readAllRows((from, to) => supabase.from("workspace_members")
      .select("workspace_id, user_id, role, created_at")
      .order("created_at", { ascending: true })
      .range(from, to)),
    readAllRows((from, to) => supabase.from("subscriptions")
      .select("workspace_id, provider, plan, status, currency, amount_minor, current_period_start, current_period_end")
      .order("created_at", { ascending: true })
      .range(from, to)),
    readAllRows((from, to) => supabase.from("usage_events")
      .select("workspace_id, meeting_id, event_type, quantity, unit, period_start, created_at")
      .order("created_at", { ascending: true })
      .range(from, to)),
    readAllRows((from, to) => supabase.from("workspace_invitations")
      .select("id, workspace_id, email, role, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: true })
      .range(from, to)),
  ]);
  if ([membershipRows, subscriptionRows, usageRows, invitationRows]
    .some((result) => result.error || result.tooLarge)) {
    return Response.json({ error: "Workspace and billing data could not be loaded for export." }, { status: 503 });
  }
  const memberships = ExportMembershipsSchema.safeParse(membershipRows.rows);
  const subscriptions = ExportSubscriptionsSchema.safeParse(subscriptionRows.rows);
  const usage = ExportUsageSchema.safeParse(usageRows.rows);
  const invitations = ExportInvitationsSchema.safeParse(invitationRows.rows);
  const parsedTranscripts = ExportTranscriptsSchema.safeParse(transcripts);
  const parsedMinutes = ExportMinutesSchema.safeParse(minutes);
  const parsedActionItems = ExportActionItemsSchema.safeParse(actionItems);
  if (
    !memberships.success || !subscriptions.success || !usage.success || !invitations.success ||
    !parsedTranscripts.success || !parsedMinutes.success || !parsedActionItems.success
  ) {
    return Response.json({ error: "Meeting or workspace data is unavailable for export." }, { status: 503 });
  }

  const retainedAudio = meetings.data.filter((meeting) =>
    meeting.audio_retention === "keep" && meeting.audio_deletion_status !== "deleted"
  );
  let audioLinks: Array<{ meetingId: string; url: string }> = [];
  if (retainedAudio.length > 0) {
    let admin;
    try {
      admin = createSupabaseAdminClient();
    } catch {
      return Response.json({ error: "Retained audio could not be prepared for export." }, { status: 503 });
    }
    const { data, error } = await admin.storage.from("meeting-audio")
      .createSignedUrls(retainedAudio.map(({ storage_path }) => storage_path), 300);
    if (error || !data || data.length !== retainedAudio.length || data.some((entry) => !entry.signedUrl)) {
      return Response.json({ error: "Retained audio could not be prepared for export." }, { status: 503 });
    }
    audioLinks = data.map((entry, index) => ({
      meetingId: retainedAudio[index].id,
      url: entry.signedUrl!,
    }));
  }

  const exported = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null, profile: profile.data },
    workspaces: workspaces.data,
    workspaceMemberships: memberships.data,
    workspaceInvitations: invitations.data,
    subscriptions: subscriptions.data,
    usageEvents: usage.data,
    meetings: meetings.data.map((meeting) => ({
      id: meeting.id,
      owner_id: meeting.owner_id,
      title: meeting.title,
      status: meeting.status,
      source_type: meeting.source_type,
      audio_retention: meeting.audio_retention,
      audio_deletion_status: meeting.audio_deletion_status,
      size_bytes: meeting.size_bytes,
      duration_seconds: meeting.duration_seconds,
      workspace_id: meeting.workspace_id,
      created_at: meeting.created_at,
    })),
    transcripts: parsedTranscripts.data,
    minutes: parsedMinutes.data,
    actionItems: parsedActionItems.data,
    retainedAudio: audioLinks,
    retainedAudioLinksExpireInSeconds: 300,
  };
  const serialized = JSON.stringify(exported);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EXPORT_BYTES) {
    return Response.json({ error: "Your export exceeds the supported file size. Contact support for assistance." }, { status: 413 });
  }
  return new Response(serialized, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="minutemate-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
