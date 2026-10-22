import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/billing/checkout/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_minutemate");
  vi.stubEnv("PAYSTACK_PLAN_CODE", "PLN_test");
  vi.stubEnv("PAYSTACK_AMOUNT_MINOR", "250000");
  vi.stubEnv("PAYSTACK_CURRENCY", "NGN");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://minutemate.test");
});

describe("POST /api/billing/checkout", () => {
  it("rejects an invalid workspace ID", async () => {
    expect((await POST(jsonRequest({ workspaceId: "bad" }))).status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated workspace manager", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await POST(jsonRequest({ workspaceId: WORKSPACE_ID }))).status).toBe(401);
  });

  it("starts a Paystack plan checkout after verifying workspace role", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/example", reference: "reference-1" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const insert = vi.fn(() => createQuery({ error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-id", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" } }, error: null }) },
      from: vi.fn(() => createQuery({ data: { role: "owner" }, error: null })),
    });
    const response = await POST(jsonRequest({ workspaceId: WORKSPACE_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authorizationUrl: "https://checkout.paystack.com/example" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      reference: "reference-1",
      workspace_id: WORKSPACE_ID,
      status: "pending",
    }));
  });
});

function jsonRequest(value: unknown) {
  return new Request("https://minutemate.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
