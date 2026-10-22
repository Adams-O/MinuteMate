import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workspaces/accept-invitation/route";

const mocks = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));

const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => mocks.createSupabaseServerClient.mockReset());

describe("POST /api/workspaces/accept-invitation", () => {
  it("requires the invitee to authenticate", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await POST(jsonRequest("A".repeat(43)))).status).toBe(401);
  });

  it("accepts an invitation through the email-checking database function", async () => {
    const rpc = vi.fn(async () => ({ data: WORKSPACE_ID, error: null }));
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: {
        id: "user-id", email: "invitee@example.com", email_confirmed_at: "2026-10-01T00:00:00Z",
      } }, error: null }) },
      rpc,
    });
    const token = "A".repeat(43);
    const response = await POST(jsonRequest(token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaceId: WORKSPACE_ID });
    expect(rpc).toHaveBeenCalledWith("accept_workspace_invitation", {
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects invalid invitation tokens", async () => {
    expect((await POST(jsonRequest("not-a-token"))).status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

function jsonRequest(token: string) {
  return new Request("https://minutemate.test/api/workspaces/accept-invitation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}
