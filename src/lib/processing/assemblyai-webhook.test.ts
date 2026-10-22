import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processNextAssemblyAIWebhook } from "@/lib/processing/assemblyai-webhook";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  generateMinutesFromTranscript: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("@/lib/ai/generate-minutes", () => ({
  InvalidMinutesOutputError: class InvalidMinutesOutputError extends Error {},
  generateMinutesFromTranscript: mocks.generateMinutesFromTranscript,
}));

const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";
const JOB_ID = "assembly-job-1";

beforeEach(() => {
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-assemblyai-key");
  mocks.createSupabaseAdminClient.mockReset();
  mocks.generateMinutesFromTranscript.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("processNextAssemblyAIWebhook", () => {
  it("saves a completed transcript and validated minutes atomically", async () => {
    const { admin, tables } = createWorkerClient("processing", "keep");
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    mocks.generateMinutesFromTranscript.mockResolvedValue({
      summary: "The team reviewed the launch.",
      key_points: ["The team reviewed the launch."],
      decisions: [],
      action_items: [],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: JOB_ID,
      status: "completed",
      text: "The team reviewed the launch.",
      audio_duration: 30,
      language_code: "en",
      utterances: [{
        start: 0,
        end: 30000,
        speaker: "A",
        text: "The team reviewed the launch.",
      }],
    }), { status: 200 })));

    await expect(processNextAssemblyAIWebhook()).resolves.toBe("processed");

    expect(mocks.generateMinutesFromTranscript).toHaveBeenCalledWith("The team reviewed the launch.");
    expect(admin.rpc).toHaveBeenCalledWith("complete_meeting_processing", expect.objectContaining({
      p_meeting_id: MEETING_ID,
      p_duration_seconds: 30,
    }));
    expect(tables.events).toHaveBeenCalledTimes(3);
  });

  it("schedules a retry when the provider result is temporarily unavailable", async () => {
    const { admin, tables } = createWorkerClient("processing", "keep");
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(processNextAssemblyAIWebhook()).resolves.toBe("processed");

    expect(mocks.generateMinutesFromTranscript).not.toHaveBeenCalled();
    expect(tables.events).toHaveBeenCalledTimes(3);
  });

  it("does not regenerate completed meeting data when retrying a duplicate job", async () => {
    const { admin } = createWorkerClient("ready", "keep");
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    vi.stubGlobal("fetch", vi.fn());

    await expect(processNextAssemblyAIWebhook()).resolves.toBe("processed");

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateMinutesFromTranscript).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

function createWorkerClient(status: "processing" | "ready", audioRetention: "keep" | "delete_after_transcription") {
  const eventResults = [
    {
      data: {
        id: "event-1",
        meeting_id: MEETING_ID,
        transcription_job_id: JOB_ID,
        event_status: "completed",
        attempt_count: 0,
        locked_until: null,
        state: "queued",
      },
      error: null,
    },
    { data: { id: "event-1" }, error: null },
    { error: null },
  ];
  const meetingResult = {
    data: {
      id: MEETING_ID,
      status,
      owner_id: "7bafac91-b9a9-49a3-b933-4268998558de",
      storage_path: "7bafac91-b9a9-49a3-b933-4268998558de/cb92c60c-84a0-43e7-8181-83df42af2212/cb92c60c-84a0-43e7-8181-83df42af2212.wav",
      audio_retention: audioRetention,
      audio_deletion_status: "not_requested",
      transcription_job_id: JOB_ID,
      duration_seconds: 30,
    },
    error: null,
  };
  const tables = {
    events: vi.fn(() => createQuery(eventResults.shift() ?? { error: null })),
    meetings: vi.fn(() => createQuery(meetingResult)),
  };
  const admin = {
    from: vi.fn((table: string) => table === "assemblyai_webhook_events" ? tables.events() : tables.meetings()),
    rpc: vi.fn(async () => ({ error: null })),
    storage: { from: vi.fn() },
  };
  return { admin, tables };
}
