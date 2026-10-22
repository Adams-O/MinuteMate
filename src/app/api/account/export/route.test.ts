import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/account/export/route";

const mocks = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("server-only", () => ({}));

beforeEach(() => mocks.createSupabaseServerClient.mockReset());

describe("GET /api/account/export", () => {
  it("requires authentication before reading account records", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    expect((await GET()).status).toBe(401);
  });

  it("returns a no-store JSON attachment after an authenticated export", async () => {
    function tableQuery(data: unknown) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        in: vi.fn(() => query),
        range: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data, error: null })),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return query;
    }
    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { display_name: null, created_at: "2026-10-23" }, error: null }),
    };
    const workspaceQuery = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const meetingQuery = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "a-user-id", email: "user@example.test" } }, error: null }) },
      from: vi.fn((table: string) => (
        table === "profiles" ? profileQuery :
          table === "workspaces" ? workspaceQuery :
            table === "meetings" ? meetingQuery : tableQuery([])
      )),
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect((await response.json()).account.email).toBe("user@example.test");
  });
});
