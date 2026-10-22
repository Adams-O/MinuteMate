import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOwnedMeetingContent } from "@/lib/meeting-content";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";
const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";

beforeEach(() => mocks.createSupabaseServerClient.mockReset());

describe("getOwnedMeetingContent", () => {
  it("returns unauthenticated without querying meeting content", async () => {
    const from = vi.fn();
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from,
    });
    await expect(getOwnedMeetingContent(MEETING_ID)).resolves.toEqual({ kind: "unauthenticated" });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses RLS-scoped access for authorized workspace members", async () => {
    const meetingQuery = createQuery({
      data: { id: MEETING_ID, title: "Planning", status: "ready" },
      error: null,
    });
    const minutesQuery = createQuery({
      data: { summary: "Plan agreed.", key_points: ["Prepare notes."], decisions: [] },
      error: null,
    });
    const itemsQuery = createQuery({ data: [], error: null });
    const meetingFilter = vi.spyOn(meetingQuery, "eq");
    const from = vi.fn()
      .mockReturnValueOnce(meetingQuery)
      .mockReturnValueOnce(minutesQuery)
      .mockReturnValueOnce(itemsQuery);
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from,
    });

    const result = await getOwnedMeetingContent(MEETING_ID);

    expect(meetingFilter).toHaveBeenCalledWith("id", MEETING_ID);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.content.meeting.title).toBe("Planning");
      expect(result.content.actionItems).toEqual([]);
    }
  });

  it("does not allow exports of unfinished meetings", async () => {
    const meetingQuery = createQuery({
      data: { id: MEETING_ID, title: "Planning", status: "processing" },
      error: null,
    });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: vi.fn(() => meetingQuery),
    });
    await expect(getOwnedMeetingContent(MEETING_ID)).resolves.toEqual({ kind: "not_ready" });
  });
});
