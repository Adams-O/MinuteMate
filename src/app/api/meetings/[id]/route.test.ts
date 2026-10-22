import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "@/app/api/meetings/[id]/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";
const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
});

describe("PATCH /api/meetings/[id]", () => {
  it("rejects invalid edits before accessing meeting data", async () => {
    const response = await PATCH(jsonRequest({ type: "title", title: "" }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const response = await PATCH(jsonRequest({ type: "title", title: "Updated" }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("updates title only after RLS confirms workspace access", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const titleUpdate = createQuery({ data: { id: MEETING_ID }, error: null });
    const from = vi.fn().mockReturnValue(titleUpdate);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const response = await PATCH(jsonRequest({ type: "title", title: "Updated title" }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("updates generated minutes and action-item fields for their parent meeting", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const from = vi.fn().mockReturnValue(createQuery({ data: { meeting_id: MEETING_ID }, error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const minutesResponse = await PATCH(jsonRequest({
      type: "minutes",
      summary: "Updated summary.",
      key_points: ["Updated point."],
      decisions: ["Updated decision."],
    }), { params: Promise.resolve({ id: MEETING_ID }) });
    expect(minutesResponse.status).toBe(200);

    const actionFrom = vi.fn()
      .mockReturnValueOnce(createQuery({ data: { id: "e2dc4f34-e58f-4d4a-a214-44e239385c1c" }, error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ from: actionFrom });
    const actionResponse = await PATCH(jsonRequest({
      type: "action_item",
      actionItemId: "e2dc4f34-e58f-4d4a-a214-44e239385c1c",
      task: "Complete review.",
      owner: "Alex",
      deadline: "Friday",
      priority: "high",
      status: "done",
    }), { params: Promise.resolve({ id: MEETING_ID }) });
    expect(actionResponse.status).toBe(200);
  });

  it("renames all matching speaker labels without returning transcript text", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const segments = [
      { start: 0, end: 1, speaker: "A", text: "Private transcript text." },
      { start: 1, end: 2, speaker: "B", text: "Another private sentence." },
      { start: 2, end: 3, speaker: "A", text: "More private transcript text." },
    ];
    const transcriptLookup = createQuery({ data: { segments }, error: null });
    const transcriptUpdate = createQuery({ data: { meeting_id: MEETING_ID }, error: null });
    const from = vi.fn().mockReturnValueOnce(transcriptLookup).mockReturnValueOnce(transcriptUpdate);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const response = await PATCH(jsonRequest({
      type: "speaker",
      currentLabel: "A",
      newLabel: "Alex",
    }), { params: Promise.resolve({ id: MEETING_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(JSON.stringify(response)).not.toContain("Private transcript text");
  });

  it("prevents two speakers from collapsing into the same label", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const from = vi.fn()
      .mockReturnValueOnce(createQuery({
        data: { segments: [
          { start: 0, end: 1, speaker: "A", text: "First." },
          { start: 1, end: 2, speaker: "B", text: "Second." },
        ] },
        error: null,
      }));
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const response = await PATCH(jsonRequest({
      type: "speaker",
      currentLabel: "A",
      newLabel: "B",
    }), { params: Promise.resolve({ id: MEETING_ID }) });

    expect(response.status).toBe(409);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/meetings/[id]", () => {
  it("rejects malformed meeting IDs", async () => {
    const response = await DELETE(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: "bad-id" }),
    });
    expect(response.status).toBe(404);
  });

  it("requires an authenticated user", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const response = await DELETE(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("removes audio before deleting the owner-scoped meeting and children", async () => {
    const from = vi.fn()
      .mockReturnValueOnce(createQuery({
        data: { id: MEETING_ID, owner_id: USER_ID, storage_path: `${USER_ID}/${MEETING_ID}/audio.wav` },
        error: null,
      }))
      .mockReturnValueOnce(createQuery({ error: null }));
    const remove = vi.fn(async () => ({ error: null }));
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from,
      storage: { from: () => ({ remove }) },
    });

    const response = await DELETE(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(204);
    expect(remove).toHaveBeenCalledWith([`${USER_ID}/${MEETING_ID}/audio.wav`]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("does not remove meeting data if audio deletion fails", async () => {
    const from = vi.fn(() => createQuery({
      data: { id: MEETING_ID, owner_id: USER_ID, storage_path: "audio.wav" },
      error: null,
    }));
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from,
      storage: { from: () => ({ remove: async () => ({ error: new Error("storage unavailable") }) }) },
    });

    const response = await DELETE(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(503);
    expect(from).toHaveBeenCalledOnce();
  });
});

function ownerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn(() => createQuery({
      data: {
        id: MEETING_ID,
        owner_id: USER_ID,
        status: "ready",
        storage_path: `${USER_ID}/${MEETING_ID}/${MEETING_ID}.wav`,
      },
      error: null,
    })),
  };
}

function jsonRequest(value: unknown): Request {
  return new Request("https://minutemate.test/api/meetings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
