import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/meetings/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";
const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
});

describe("POST /api/meetings", () => {
  it("rejects recordings without consent", async () => {
    const response = await POST(jsonRequest({
      title: "Weekly sync",
      sourceType: "recording",
      fileName: "capture.webm",
      mimeType: "audio/webm",
      sizeBytes: 1000,
      durationSeconds: 10,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const response = await POST(jsonRequest(uploadInput()));

    expect(response.status).toBe(401);
  });

  it("creates a quota-reserved workspace upload authorization", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: vi.fn(() => createQuery({ data: [{ workspace_id: WORKSPACE_ID }], error: null })),
      storage: {
        from: vi.fn(() => ({
          createSignedUploadUrl: async () => ({
            data: { token: "short-lived-upload-token" },
            error: null,
          }),
        })),
      },
    };
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    const response = await POST(jsonRequest(uploadInput()));
    const body = await response.json() as {
      meetingId: string;
      path: string;
      token: string;
      contentType: string;
    };

    expect(response.status).toBe(201);
    expect(body.path).toMatch(new RegExp(`^${USER_ID}/`));
    expect(body.token).toBe("short-lived-upload-token");
    expect(body.contentType).toBe("audio/wav");
    expect(rpc).toHaveBeenCalledWith("create_meeting_with_usage", expect.objectContaining({
      p_user_id: USER_ID,
      p_workspace_id: WORKSPACE_ID,
      p_max_meetings: 3,
      p_max_audio_seconds: 5400,
    }));
  });
});

function uploadInput() {
  return {
    title: "Weekly sync",
    sourceType: "upload",
    consent: false,
    fileName: "weekly-sync.wav",
    mimeType: "audio/wav",
    sizeBytes: 1200,
  };
}

function jsonRequest(value: unknown): Request {
  return new Request("https://minutemate.test/api/meetings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
