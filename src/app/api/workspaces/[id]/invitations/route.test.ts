import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[id]/invitations/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  send: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";
const USER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
  mocks.send.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://minutemate.test");
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "minutes@example.com");
});

describe("POST /api/workspaces/[id]/invitations", () => {
  it("rejects malformed workspace IDs", async () => {
    expect((await POST(jsonRequest({ email: "invitee@example.com" }), {
      params: Promise.resolve({ id: "bad" }),
    })).status).toBe(404);
  });

  it("requires authentication", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await POST(jsonRequest({ email: "invitee@example.com" }), {
      params: Promise.resolve({ id: WORKSPACE_ID }),
    })).status).toBe(401);
  });

  it("stores only a token hash and emails the acceptance link to an authorized invitee", async () => {
    const membershipQuery = createQuery({ data: { role: "owner" }, error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID, email: "owner@example.com" } }, error: null }) },
      from: vi.fn(() => membershipQuery),
    });
    const inserted: Record<string, unknown>[] = [];
    const insert = vi.fn((value: Record<string, unknown>) => {
      inserted.push(value);
      return createQuery({ data: { id: "e2dc4f34-e58f-4d4a-a214-44e239385c1c" }, error: null });
    });
    const adminFrom = vi.fn(() => ({ insert }));
    mocks.createSupabaseAdminClient.mockReturnValue({ from: adminFrom });
    mocks.send.mockResolvedValue({ error: null });

    const response = await POST(jsonRequest({ email: "invitee@example.com" }), {
      params: Promise.resolve({ id: WORKSPACE_ID }),
    });

    expect(response.status).toBe(201);
    const stored = inserted[0] as { token_hash: string };
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});

function jsonRequest(value: unknown) {
  return new Request(`https://minutemate.test/api/workspaces/${WORKSPACE_ID}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
