import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/paystack/route";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

const SECRET = "test-paystack-secret";
const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => {
  mocks.createSupabaseAdminClient.mockReset();
  vi.stubEnv("PAYSTACK_SECRET_KEY", SECRET);
  vi.stubEnv("PAYSTACK_AMOUNT_MINOR", "250000");
  vi.stubEnv("PAYSTACK_CURRENCY", "NGN");
});

describe("POST /api/webhooks/paystack", () => {
  it("rejects an invalid webhook signature before parsing or calling providers", async () => {
    const response = await POST(new Request("https://minutemate.test/api/webhooks/paystack", {
      method: "POST",
      headers: { "x-paystack-signature": "0".repeat(128) },
      body: '{"event":"charge.success","data":{"reference":"ref-1"}}',
    }));
    expect(response.status).toBe(401);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("verifies successful transactions and applies payments idempotently", async () => {
    const body = JSON.stringify({
        event: "charge.success",
        data: { reference: "ref-1", subscription_code: "SUB_test" },
      });
    const signature = createHmac("sha512", SECRET).update(body).digest("hex");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: {
        status: "success",
        reference: "ref-1",
        amount: 250000,
        currency: "NGN",
        metadata: { workspaceId: WORKSPACE_ID },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });

    const response = await POST(new Request("https://minutemate.test/api/webhooks/paystack", {
      method: "POST",
      headers: { "x-paystack-signature": signature },
      body,
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_paystack_payment", expect.objectContaining({
      p_reference: "ref-1",
      p_amount_minor: 250000,
      p_currency: "NGN",
      p_provider_subscription_id: "SUB_test",
    }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
