"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MeetingStatusSchema, type ActionItemRecordSchema, type MeetingRecordSchema, type MinutesRecordSchema, type TranscriptRecordSchema } from "@/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { z } from "zod";
import {
  ActionItemEditor,
  MeetingTitleEditor,
  MinutesEditor,
  SpeakerEditor,
} from "@/components/meeting-editors";
import { MeetingCollaboration } from "@/components/meeting-collaboration";

type MeetingDetailProps = {
  meeting: z.infer<typeof MeetingRecordSchema>;
  transcript: z.infer<typeof TranscriptRecordSchema> | null;
  minutes: z.infer<typeof MinutesRecordSchema> | null;
  actionItems: z.infer<typeof ActionItemRecordSchema>[];
};

const MeetingStatusUpdateSchema = z.object({
  status: MeetingStatusSchema,
  failure_code: z.string().nullable(),
  audio_deletion_status: z.enum(["not_requested", "pending", "deleted", "failed"]),
});

const tabs = ["Summary", "Transcript", "Action Items"] as const;
type Tab = (typeof tabs)[number];

export function MeetingDetail({ meeting, transcript, minutes, actionItems }: MeetingDetailProps) {
  const router = useRouter();
  const [status, setStatus] = useState(meeting.status);
  const [failureCode, setFailureCode] = useState(meeting.failure_code);
  const [audioDeletionStatus, setAudioDeletionStatus] = useState(meeting.audio_deletion_status);
  const [activeTab, setActiveTab] = useState<Tab>("Summary");
  const [busy, setBusy] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`meeting-status-${meeting.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetings", filter: `id=eq.${meeting.id}` },
        (payload) => {
          const update = MeetingStatusUpdateSchema.safeParse(payload.new);
          if (!update.success) return;
          setStatus(update.data.status);
          setFailureCode(update.data.failure_code);
          setAudioDeletionStatus(update.data.audio_deletion_status);
          if (update.data.status === "ready") router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meeting.id, router]);

  const retryAudioDeletion = async () => {
    setRetentionBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/retention`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "Audio deletion could not be completed. Please retry.");
        return;
      }
      setAudioDeletionStatus("deleted");
      router.refresh();
    } catch {
      setError("Audio deletion could not be completed. Please retry.");
    } finally {
      setRetentionBusy(false);
    }
  };

  const retryProcessing = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/complete`, { method: "POST" });
      const body = await response.json().catch(() => null) as {
        error?: string;
        status?: string;
      } | null;
      if (!response.ok) {
        setError(body?.error ?? "Processing could not be started. Please retry.");
        return;
      }
      setStatus("processing");
      setFailureCode(null);
      router.refresh();
    } catch {
      setError("Processing could not be started. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const deleteMeeting = async () => {
    if (!window.confirm("Delete this meeting and its audio, transcript, minutes, and action items?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "The meeting could not be deleted. Please try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("The meeting could not be deleted. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 text-slate-50 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-medium text-sky-300 hover:text-sky-200">← All meetings</Link>
          <h1 className="mt-4 text-3xl font-semibold">{meeting.title}</h1>
          {status === "ready" ? (
            <MeetingTitleEditor meetingId={meeting.id} title={meeting.title} onSaved={() => router.refresh()} />
          ) : null}
          <p className="mt-2 text-sm text-slate-400">
            Status: <span className="capitalize text-slate-200">{status.replace("_", " ")}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={deleteMeeting}
          disabled={busy}
          className="rounded-lg border border-rose-800 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-950/50 disabled:opacity-60"
        >
          {busy ? "Deleting..." : "Delete meeting"}
        </button>
      </div>

      {status === "failed" ? (
        <div role="status" className="mt-6 rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
          Processing failed{failureCode ? ` (${failureCode.replaceAll("_", " ")})` : ""}.
          {["transcription_submit_failed", "transcription_submit_invalid"].includes(failureCode ?? "") ? (
            <button
              type="button"
              onClick={retryProcessing}
              disabled={busy}
              className="ml-3 underline underline-offset-2 disabled:opacity-60"
            >
              {busy ? "Retrying..." : "Retry processing"}
            </button>
          ) : (
            <span> Delete this meeting and upload the source again to retry.</span>
          )}
        </div>
      ) : status !== "ready" ? (
        <div role="status" className="mt-6 rounded-xl border border-sky-900 bg-sky-950/30 p-4 text-sm text-sky-100">
          {status === "uploading" ? "Your upload is being finalized." : "Transcription and minutes are processing. This page will update when they are ready."}
          {status === "uploading" ? (
            <button
              type="button"
              onClick={retryProcessing}
              disabled={busy}
              className="ml-3 underline underline-offset-2 disabled:opacity-60"
            >
              {busy ? "Checking..." : "Check upload"}
            </button>
          ) : null}
        </div>
      ) : null}

      {meeting.audio_retention === "delete_after_transcription" &&
      audioDeletionStatus !== "deleted" &&
      (status === "ready" || status === "failed") ? (
        <div role="status" className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-100">
          {audioDeletionStatus === "failed"
            ? "Source audio could not be deleted."
            : "Source audio deletion is pending."}
          <button
            type="button"
            onClick={retryAudioDeletion}
            disabled={retentionBusy}
            className="ml-3 underline underline-offset-2 disabled:opacity-60"
          >
            {retentionBusy ? "Retrying..." : "Retry deletion"}
          </button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}

      {status === "ready" ? <MeetingCollaboration meetingId={meeting.id} /> : null}

      <div className="mt-8">
        <div role="tablist" aria-label="Meeting details" className="flex gap-2 border-b border-slate-800">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls="meeting-tab-panel"
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium ${
                activeTab === tab ? "border-sky-400 text-sky-200" : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <section id="meeting-tab-panel" role="tabpanel" className="mt-6 space-y-6">
          {activeTab === "Summary" ? (
            status !== "ready" ? (
              <p className="text-slate-400">The summary will appear here when processing finishes.</p>
            ) : minutes ? (
              <>
                <MinutesEditor meetingId={meeting.id} minutes={minutes} onSaved={() => router.refresh()} />
                <div>
                  <h2 className="text-lg font-semibold">Summary</h2>
                  <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-300">{minutes.summary}</p>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Key points</h2>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-300">
                    {minutes.key_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
                  </ul>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Decisions</h2>
                  {minutes.decisions.length ? (
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-300">
                      {minutes.decisions.map((decision, index) => <li key={`${index}-${decision}`}>{decision}</li>)}
                    </ul>
                  ) : <p className="mt-2 text-slate-400">No decisions were identified in the transcript.</p>}
                </div>
              </>
            ) : <p className="text-slate-400">Summary data is not available.</p>
          ) : activeTab === "Transcript" ? (
            status !== "ready" ? (
              <p className="text-slate-400">The transcript will appear here when processing finishes.</p>
            ) : transcript?.segments.length ? (
              <>
                <SpeakerEditor meetingId={meeting.id} transcript={transcript} onSaved={() => router.refresh()} />
                <ol className="space-y-4">
                  {transcript.segments.map((segment, index) => (
                    <li key={`${segment.start}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                      <p className="text-xs text-slate-400">
                        {formatTimestamp(segment.start)}{segment.speaker ? ` · ${segment.speaker}` : ""}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-200">{segment.text}</p>
                    </li>
                  ))}
                </ol>
              </>
            ) : <p className="text-slate-400">Transcript data is not available.</p>
          ) : status !== "ready" ? (
            <p className="text-slate-400">Action items will appear here when processing finishes.</p>
          ) : actionItems.length ? (
            <ul className="space-y-3">
              {actionItems.map((item) => (
                <li key={item.id} className="space-y-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                    <p className="font-medium text-white">{item.task}</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Owner: {item.owner} · Deadline: {item.deadline} · Priority: {item.priority ?? "Not stated"} · Status: {item.status.replace("_", " ")}
                    </p>
                  </div>
                  <ActionItemEditor meetingId={meeting.id} item={item} onSaved={() => router.refresh()} />
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-400">No action items were identified in the transcript.</p>}
        </section>
      </div>
    </main>
  );
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
