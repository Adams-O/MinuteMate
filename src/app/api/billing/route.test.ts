import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/billing/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));

const WORKSPACE_ID = "24430e2e-3c07-4a92-a632-58183cd8a5aa";

beforeEach(() => mocks.createSupabaseServerClient.mockReset());

describe("GET /api/billing", () => {
  it("validates workspace query parameters", async () => {
    expect((await GET(new Request("https://minutemate.test/api/billing?workspaceId=bad"))).status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await GET(new Request(`https://minutemate.test/api/billing?workspaceId=${WORKSPACE_ID}`))).status).toBe(401);
  });

  it("returns RLS-scoped plan and monthly usage", async () => {
    const queries = [
      createQuery({
        data: {
          plan: "free", status: "active", currency: null, amount_minor: null,
          current_period_start: null, current_period_end: null,
        },
        error: null,
      }),
      createQuery({
        data: [
          { event_type: "meeting_created", quantity: 1, period_start: "2026-10-01" },
          { event_type: "audio_minutes_reserved", quantity: 600, period_start: "2026-10-01" },
        ],
        error: null,
      }),
    ];
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) },
      from: vi.fn(() => queries.shift()),
    });
    const response = await GET(new Request(`https://minutemate.test/api/billing?workspaceId=${WORKSPACE_ID}`));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.usage).toMatchObject({ meetings: 1, audioSeconds: 600, meetingLimit: 3, audioSecondsLimit: 5400 });
    expect(data.isEntitled).toBe(false);
    expect(data.price).toBeNull();
  });
});
