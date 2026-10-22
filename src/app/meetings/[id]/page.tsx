import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { MeetingDetail } from "@/components/meeting-detail";
import {
  ActionItemRecordSchema,
  MeetingRecordSchema,
  MinutesRecordSchema,
  TranscriptRecordSchema,
} from "@/lib/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const MeetingIdSchema = z.string().uuid();

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-300">Loading meeting...</main>}>
      <MeetingPageContent params={params} />
    </Suspense>
  );
}

async function MeetingPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: meetingRow, error: meetingError } = await supabase
    .from("meetings")
    .select("id, title, status, created_at, duration_seconds, failure_code, audio_retention, audio_deletion_status")
    .eq("id", id)
    .maybeSingle();

  if (meetingError) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-50">Meeting could not be loaded. Please try again.</main>;
  }
  if (!meetingRow) notFound();

  const meeting = MeetingRecordSchema.safeParse(meetingRow);
  if (!meeting.success) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-50">Meeting data is unavailable.</main>;
  }

  const [transcriptResult, minutesResult, actionItemsResult] = await Promise.all([
    supabase.from("transcripts").select("segments, language").eq("meeting_id", id).maybeSingle(),
    supabase.from("minutes").select("summary, key_points, decisions").eq("meeting_id", id).maybeSingle(),
    supabase.from("action_items").select("id, task, owner, deadline, priority, status").eq("meeting_id", id).order("created_at"),
  ]);

  if (transcriptResult.error || minutesResult.error || actionItemsResult.error) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-50">Meeting details could not be loaded. Please refresh to try again.</main>;
  }

  const transcript = transcriptResult.data
    ? TranscriptRecordSchema.safeParse(transcriptResult.data)
    : { success: true as const, data: null };
  const minutes = minutesResult.data
    ? MinutesRecordSchema.safeParse(minutesResult.data)
    : { success: true as const, data: null };
  const actionItems = ActionItemRecordSchema.array().safeParse(actionItemsResult.data ?? []);

  if (!transcript.success || !minutes.success || !actionItems.success) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-50">Meeting details are unavailable.</main>;
  }

  return (
    <MeetingDetail
      meeting={meeting.data}
      transcript={transcript.data}
      minutes={minutes.data}
      actionItems={actionItems.data}
    />
  );
}
