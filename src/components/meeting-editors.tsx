"use client";

import { FormEvent, useState } from "react";
import { z } from "zod";
import { type ActionItemRecordSchema, type MinutesRecordSchema, type TranscriptRecordSchema } from "@/lib/schemas";

type ActionItem = z.infer<typeof ActionItemRecordSchema>;
type Minutes = z.infer<typeof MinutesRecordSchema>;
type Transcript = z.infer<typeof TranscriptRecordSchema>;

function useMeetingPatch(meetingId: string, onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (payload: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        setError(parsed.success ? parsed.data.error : "Changes could not be saved.");
        return false;
      }
      onSaved();
      return true;
    } catch {
      setError("Changes could not be saved. Please retry.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

export function MeetingTitleEditor({
  meetingId,
  title,
  onSaved,
}: {
  meetingId: string;
  title: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(title);
  const patch = useMeetingPatch(meetingId, onSaved);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void patch.save({ type: "title", title: value });
  };
  return (
    <form onSubmit={submit} className="mt-4 flex max-w-2xl flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="meeting-title">Meeting title</label>
      <input
        id="meeting-title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={200}
        required
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      />
      <button type="submit" disabled={patch.busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
        {patch.busy ? "Saving..." : "Save title"}
      </button>
      {patch.error ? <span role="alert" className="basis-full text-sm text-rose-300">{patch.error}</span> : null}
    </form>
  );
}

export function MinutesEditor({
  meetingId,
  minutes,
  onSaved,
}: {
  meetingId: string;
  minutes: Minutes;
  onSaved: () => void;
}) {
  const [summary, setSummary] = useState(minutes.summary);
  const [keyPoints, setKeyPoints] = useState(minutes.key_points.join("\n"));
  const [decisions, setDecisions] = useState(minutes.decisions.join("\n"));
  const patch = useMeetingPatch(meetingId, onSaved);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void patch.save({
      type: "minutes",
      summary,
      key_points: keyPoints.split("\n").map((item) => item.trim()).filter(Boolean),
      decisions: decisions.split("\n").map((item) => item.trim()).filter(Boolean),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <h3 className="font-medium text-white">Edit summary and minutes</h3>
      <label className="block text-sm text-slate-300">
        Summary
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={4000} required rows={4} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" />
      </label>
      <label className="block text-sm text-slate-300">
        Key points (one per line)
        <textarea value={keyPoints} onChange={(event) => setKeyPoints(event.target.value)} maxLength={10000} required rows={4} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" />
      </label>
      <label className="block text-sm text-slate-300">
        Decisions (one per line)
        <textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} maxLength={10000} rows={4} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" />
      </label>
      <SaveButton busy={patch.busy} error={patch.error} />
    </form>
  );

  function SaveButton({ busy, error }: { busy: boolean; error: string | null }) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
          {busy ? "Saving..." : "Save minutes"}
        </button>
        {error ? <span role="alert" className="text-sm text-rose-300">{error}</span> : null}
      </div>
    );
  }
}

export function ActionItemEditor({
  meetingId,
  item,
  onSaved,
}: {
  meetingId: string;
  item: ActionItem;
  onSaved: () => void;
}) {
  const [task, setTask] = useState(item.task);
  const [owner, setOwner] = useState(item.owner);
  const [deadline, setDeadline] = useState(item.deadline);
  const [priority, setPriority] = useState(item.priority ?? "Not stated");
  const [status, setStatus] = useState(item.status);
  const patch = useMeetingPatch(meetingId, onSaved);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void patch.save({
      type: "action_item",
      actionItemId: item.id,
      task,
      owner,
      deadline,
      priority,
      status,
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4 sm:grid-cols-2">
      <label className="text-sm text-slate-300 sm:col-span-2">
        Task
        <input value={task} onChange={(event) => setTask(event.target.value)} maxLength={500} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
      </label>
      <label className="text-sm text-slate-300">
        Owner
        <input value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
      </label>
      <label className="text-sm text-slate-300">
        Deadline
        <input value={deadline} onChange={(event) => setDeadline(event.target.value)} maxLength={200} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
      </label>
      <label className="text-sm text-slate-300">
        Priority
        <select value={priority ?? "Not stated"} onChange={(event) => setPriority(event.target.value as typeof priority)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
          {["Not stated", "low", "medium", "high"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="text-sm text-slate-300">
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </label>
      <SaveControls busy={patch.busy} error={patch.error} label="Save action item" />
    </form>
  );
}

export function SpeakerEditor({
  meetingId,
  transcript,
  onSaved,
}: {
  meetingId: string;
  transcript: Transcript;
  onSaved: () => void;
}) {
  const labels = [...new Set(transcript.segments.map((segment) => segment.speaker).filter((speaker): speaker is string => Boolean(speaker)))];
  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <h3 className="font-medium text-white">Speaker names</h3>
      {labels.map((label) => <SpeakerLabelEditor key={label} meetingId={meetingId} label={label} onSaved={onSaved} />)}
      {!labels.length ? <p className="text-sm text-slate-400">No speaker labels are available.</p> : null}
    </div>
  );
}

function SpeakerLabelEditor({
  meetingId,
  label,
  onSaved,
}: {
  meetingId: string;
  label: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(label);
  const patch = useMeetingPatch(meetingId, onSaved);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void patch.save({ type: "speaker", currentLabel: label, newLabel: value });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-slate-300" htmlFor={`speaker-${label}`}>Speaker {label}</label>
      <input id={`speaker-${label}`} value={value} onChange={(event) => setValue(event.target.value)} maxLength={80} required className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" />
      <button type="submit" disabled={patch.busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
        {patch.busy ? "Saving..." : "Rename"}
      </button>
      {patch.error ? <span role="alert" className="basis-full text-sm text-rose-300">{patch.error}</span> : null}
    </form>
  );
}

function SaveControls({ busy, error, label }: { busy: boolean; error: string | null; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
      <button type="submit" disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
        {busy ? "Saving..." : label}
      </button>
      {error ? <span role="alert" className="text-sm text-rose-300">{error}</span> : null}
    </div>
  );
}
