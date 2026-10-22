import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/meetings/[id]/share/route";
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
const SHARE_ID = "e2dc4f34-e58f-4d4a-a214-44e239385c1c";

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://minutemate.test");
});

describe("/api/meetings/[id]/share", () => {
  it("requires an authenticated owner", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const response = await POST(jsonRequest({ expiresInHours: 24 }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("creates a one-time link with bounded expiry after checking ownership", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const inserted: Record<string, unknown>[] = [];
    const insertQuery = createQuery({
      data: {
        id: SHARE_ID,
        expires_at: "2026-10-23T02:00:00.000Z",
        revoked_at: null,
        created_at: "2026-10-22T02:00:00.000Z",
      },
      error: null,
    });
    const insert = vi.fn((value: Record<string, unknown>) => {
      inserted.push(value);
      return insertQuery;
    });
    const from = vi.fn().mockReturnValueOnce({ insert });
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    const response = await POST(jsonRequest({ expiresInHours: 24 }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    const body = await response.json() as { share: { url: string } };

    expect(response.status).toBe(201);
    expect(body.share.url).toMatch(/^https:\/\/minutemate\.test\/share#[A-Za-z0-9_-]{43}$/);
    expect(inserted[0].meeting_id).toBe(MEETING_ID);
    expect(inserted[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted[0].token_hash).not.toBe(body.share.url.split("#").at(-1));
  });

  it("lists only metadata for the verified owner", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const shares = [{ id: SHARE_ID, expires_at: "2026-10-23T02:00:00.000Z", revoked_at: null, created_at: "2026-10-22T02:00:00.000Z" }];
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({ data: shares, error: null })),
    });
    const response = await GET(new Request("https://minutemate.test"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shares });
  });

  it("revokes only a share belonging to the authorized meeting", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(ownerClient());
    const updateQuery = createQuery({ data: { id: SHARE_ID }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce({ update: vi.fn(() => updateQuery) });
    mocks.createSupabaseAdminClient.mockReturnValue({ from });
    const response = await DELETE(jsonRequest({ shareId: SHARE_ID }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
  });
});

function ownerClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn(() => createQuery({ data: { id: MEETING_ID, status: "ready" }, error: null })),
  };
}

function jsonRequest(value: unknown): Request {
  return new Request(`https://minutemate.test/api/meetings/${MEETING_ID}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
