import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/meetings/search/route";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.rpc.mockReset();
});

describe("GET /api/meetings/search", () => {
  it("validates the query before requiring a session", async () => {
    const response = await GET(new Request("https://minutemate.test/api/meetings/search?q=x"));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const response = await GET(new Request("https://minutemate.test/api/meetings/search?q=launch"));
    expect(response.status).toBe(401);
  });

  it("returns validated, non-cacheable meeting matches", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: "cb92c60c-84a0-43e7-8181-83df42af2212",
        title: "Launch planning",
        status: "ready",
        created_at: "2026-10-22T00:00:00.000Z",
      }],
      error: null,
    });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      rpc: mocks.rpc,
    });

    const response = await GET(new Request("https://minutemate.test/api/meetings/search?q=launch"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("search_meetings", { p_query: "launch" });
  });
});
