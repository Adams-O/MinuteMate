"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_DURATION_MINUTES = 60;
const MAX_DURATION_SECONDS = MAX_DURATION_MINUTES * 60;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "m4a", "mp4"]);

type WorkspaceOption = { id: string; name: string };

export function MeetingCapture({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const [consent, setConsent] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState("Ready to capture");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const selectedWorkspaceId = workspaceId || workspaces[0]?.id || "";

  const formattedElapsed = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    timerRef.current = setInterval(() => {
      const elapsed = elapsedRef.current + 1;
      elapsedRef.current = elapsed;
      setElapsedSeconds(elapsed);
      if (elapsed >= MAX_DURATION_SECONDS) {
        stopTimer();
        const recorder = mediaRecorderRef.current;
        if (recorder?.state === "recording" || recorder?.state === "paused") recorder.stop();
        setIsRecording(false);
        setStatus("60-minute limit reached. Saving the recording...");
      }
    }, 1000);
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startRecording = async () => {
    if (!consent) {
      setErrorMessage("Please confirm consent before recording.");
      return;
    }

    if (!selectedWorkspaceId) {
      setErrorMessage("Create or join a workspace before recording.");
      return;
    }

    try {
      setErrorMessage(null);
      elapsedRef.current = 0;
      setElapsedSeconds(0);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        stopTimer();
        setIsPaused(false);
        const recordingBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const meetingName = `recording-${Date.now()}.webm`;
        setStatus(`Recording saved as ${meetingName}`);

        const file = new File([recordingBlob], meetingName, { type: recordingBlob.type || "audio/webm" });
        await submitFile(file, "recording");
      };

      recorder.start();
      setIsRecording(true);
      setStatus("Recording in progress");
      setIsPaused(false);
      startTimer();
    } catch {
      setErrorMessage("Microphone access was denied or unavailable in this browser.");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state !== "recording") {
      return;
    }

    mediaRecorderRef.current.pause();
    stopTimer();
    setIsPaused(true);
    setStatus("Recording paused");
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state !== "paused") {
      return;
    }

    mediaRecorderRef.current.resume();
    startTimer();
    setIsPaused(false);
    setStatus("Recording in progress");
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setIsPaused(false);
    setStatus("Stopping and saving recording...");
  };

  const submitFile = async (file: File, sourceType: "recording" | "upload") => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await createMeetingForUpload(
        file,
        sourceType,
        selectedWorkspaceId,
        sourceType === "recording" ? elapsedSeconds : undefined,
      );
      setStatus("Meeting uploaded and queued for processing");
    } catch (error) {
      setStatus("Meeting was not uploaded");
      setErrorMessage(error instanceof Error ? error.message : "The meeting could not be uploaded.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) {
      return;
    }

    const extension = uploadedFile.name.split(".").pop()?.toLowerCase();
    if (!selectedWorkspaceId) {
      setErrorMessage("Create or join a workspace before uploading.");
      event.target.value = "";
      return;
    }
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
      setErrorMessage("Choose an MP3, WAV, M4A, or MP4 file.");
      event.target.value = "";
      return;
    }
    if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage("Files must be 100 MB or smaller.");
      event.target.value = "";
      return;
    }

    await submitFile(uploadedFile, "upload");
    event.target.value = "";
  };

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Capture</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Start a meeting</h2>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
          {formattedElapsed}
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span>
          I have informed all participants and received their consent to record this meeting.
        </span>
      </label>

      <label htmlFor="capture-workspace" className="block text-sm font-medium text-slate-700">
        Save meeting to workspace
        <select
          id="capture-workspace"
          value={selectedWorkspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          disabled={workspaces.length === 0 || isSubmitting || isRecording}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          {workspaces.length === 0 ? <option value="">Create or join a workspace first</option> : null}
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={startRecording}
          disabled={!selectedWorkspaceId || isRecording || isSubmitting}
          className="rounded-full bg-sky-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isRecording ? "Recording" : "Start recording"}
        </button>
        {isRecording ? (
          <button
            type="button"
            onClick={isPaused ? resumeRecording : pauseRecording}
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
          >
            {isPaused ? "Resume recording" : "Pause recording"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={stopRecording}
          disabled={!isRecording || isSubmitting}
          className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Stop recording
        </button>
        <label className={`rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 ${isSubmitting || isRecording ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {isSubmitting ? "Uploading..." : "Upload audio"}
          <input type="file" accept=".mp3,.wav,.m4a,.mp4" onChange={handleUpload} disabled={!selectedWorkspaceId || isSubmitting || isRecording} className="hidden" />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-900">Status</p>
        <p className="mt-1" aria-live="polite">{status}</p>
      </div>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      <div className="text-xs text-slate-500">
        Limits: 60 minutes max, 100 MB max, supported types: MP3, WAV, M4A, MP4.
      </div>
    </div>
  );
}

async function createMeetingForUpload(
  file: File,
  sourceType: "recording" | "upload",
  workspaceId: string,
  durationSeconds?: number,
) {
  const response = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: file.name.replace(/\.[^.]+$/, "") || "Untitled meeting",
      workspaceId,
      sourceType,
      consent: true,
      durationSeconds,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }),
  });

  const data = await response.json().catch(() => null) as {
    error?: string;
    meetingId?: string;
    bucket?: string;
    path?: string;
    token?: string;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error || "The meeting request could not be processed.");
  }

  if (!data?.meetingId || !data.bucket || !data.path || !data.token) {
    throw new Error("A secure upload could not be authorized.");
  }

  const supabase = createSupabaseBrowserClient();
  const { error: uploadError } = await supabase.storage
    .from(data.bucket)
    .uploadToSignedUrl(data.path, data.token, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error("The audio file could not be uploaded securely.");
  }

  const completionResponse = await fetch(`/api/meetings/${data.meetingId}/complete`, {
    method: "POST",
  });
  const completionData = await completionResponse.json().catch(() => null) as { error?: string } | null;
  if (!completionResponse.ok) {
    throw new Error(completionData?.error || "The uploaded meeting could not be queued.");
  }
}
