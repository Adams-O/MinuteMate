import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/workspaces/route";

const mocks = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));

const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => mocks.createSupabaseServerClient.mockReset());

describe("/api/workspaces", () => {
  it("requires authentication to list workspaces", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await GET()).status).toBe(401);
  });

  it("creates an authorized workspace using the database RPC", async () => {
    const rpc = vi.fn(async () => ({ data: WORKSPACE_ID, error: null }));
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) },
      rpc,
    });
    const response = await POST(jsonRequest({ name: "Project team" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ workspaceId: WORKSPACE_ID });
    expect(rpc).toHaveBeenCalledWith("create_workspace", { p_name: "Project team" });
  });

  it("rejects invalid workspace details before authentication", async () => {
    const response = await POST(jsonRequest({ name: "" }));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

function jsonRequest(value: unknown) {
  return new Request("https://minutemate.test/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
