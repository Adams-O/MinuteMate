import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/meetings/[id]/retention/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";
const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
});

describe("POST /api/meetings/[id]/retention", () => {
  it("requires an authenticated user", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("retries owner-requested audio deletion and records its outcome", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: () => createQuery({
        data: {
          id: MEETING_ID,
          storage_path: `${USER_ID}/${MEETING_ID}/${MEETING_ID}.wav`,
          audio_retention: "delete_after_transcription",
          audio_deletion_status: "failed",
        },
        error: null,
      }),
      storage: { from: () => ({ remove }) },
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: () => createQuery({ error: null }),
    });

    const response = await POST(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ audioDeletionStatus: "deleted" });
    expect(remove).toHaveBeenCalledOnce();
  });
});
