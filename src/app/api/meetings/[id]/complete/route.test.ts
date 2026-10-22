import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/meetings/[id]/complete/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  inspectUploadedMedia: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("@/lib/media/inspect-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/inspect-upload")>();
  return { ...actual, inspectUploadedMedia: mocks.inspectUploadedMedia };
});

const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";
const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

beforeEach(() => {
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-assemblyai-key");
  vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://minutemate.test");
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
  mocks.inspectUploadedMedia.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/meetings/[id]/complete", () => {
  it("rejects malformed meeting IDs", async () => {
    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: "invalid" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("validates uploaded media and starts transcription asynchronously", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(createOwnerClient());
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null }))
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null })),
      rpc: vi.fn(async () => ({ data: true, error: null })),
    });
    mocks.inspectUploadedMedia.mockResolvedValue({ durationSeconds: 42.1 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "assembly-job-1",
      status: "queued",
    }), { status: 200 })));

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ meetingId: MEETING_ID, status: "processing" });
    expect(mocks.inspectUploadedMedia).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("marks a provider submission failure and returns a safe error", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(createOwnerClient());
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null }))
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null })),
      rpc: vi.fn(async () => ({ data: true, error: null })),
    });
    mocks.inspectUploadedMedia.mockResolvedValue({ durationSeconds: 42 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Transcription could not be started. Please try again.",
    });
  });

  it("stops transcription and marks the meeting retryable when monthly audio quota is exhausted", async () => {
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null }))
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null })),
      rpc: vi.fn(async () => ({ data: false, error: null })),
    };
    mocks.createSupabaseServerClient.mockResolvedValue(createOwnerClient());
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    mocks.inspectUploadedMedia.mockResolvedValue({ durationSeconds: 42 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("90-minute") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks an orphaned provider job as retryable if its ID cannot be saved", async () => {
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null }))
        .mockReturnValueOnce(createQuery({ data: null, error: { message: "database unavailable" } }))
        .mockReturnValueOnce(createQuery({ data: { id: MEETING_ID }, error: null })),
      rpc: vi.fn(async () => ({ data: true, error: null })),
    };
    mocks.createSupabaseServerClient.mockResolvedValue(createOwnerClient());
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    mocks.inspectUploadedMedia.mockResolvedValue({ durationSeconds: 42 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "assembly-job-1",
      status: "queued",
    }), { status: 200 })));

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Transcription could not be recorded. Please retry shortly.",
    });
    expect(admin.from).toHaveBeenCalledTimes(3);
  });
});

function createOwnerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: () => createQuery({
      data: {
        id: MEETING_ID,
        status: "uploading",
        failure_code: null,
        transcription_job_id: null,
        storage_path: `${USER_ID}/${MEETING_ID}/${MEETING_ID}.wav`,
        size_bytes: 1200,
        source_type: "upload",
      },
      error: null,
    }),
    storage: {
      from: () => ({
        list: async () => ({
          data: [{ name: `${MEETING_ID}.wav`, metadata: { size: 1200 } }],
          error: null,
        }),
        createSignedUrl: async () => ({
          data: { signedUrl: "https://storage.test/signed-audio" },
          error: null,
        }),
      }),
    },
  };
}
