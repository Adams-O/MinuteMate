import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/account/delete/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("server-only", () => ({}));

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.createSupabaseAdminClient.mockReset();
});

describe("POST /api/account/delete", () => {
  it("requires explicit confirmation before accessing account services", async () => {
    const response = await POST(jsonRequest({ confirmation: "delete" }));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user after confirmation", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect((await POST(jsonRequest({ confirmation: "DELETE" }))).status).toBe(401);
  });

  it("removes owned audio, transfers workspace ownership, and deletes the auth user", async () => {
    const userId = "7bafac91-b9a9-49a3-b933-4268998558de";
    const storagePath = `${userId}/cb92c60c-84a0-43e7-8181-83df42af2212/cb92c60c-84a0-43e7-8181-83df42af2212.wav`;
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
      from: () => createQuery({ data: [{ id: "cb92c60c-84a0-43e7-8181-83df42af2212", storage_path: storagePath }], error: null }),
    });
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ error: null }));
    const deleteUser = vi.fn(async () => ({ error: null }));
    const profileUpdate = createQuery({ error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn(() => profileUpdate),
      storage: { from: vi.fn(() => ({ remove })) },
      rpc,
      auth: { admin: { deleteUser } },
    });

    const response = await POST(jsonRequest({ confirmation: "DELETE" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith([storagePath]);
    expect(rpc).toHaveBeenCalledWith("prepare_account_deletion", { p_user_id: userId });
    expect(deleteUser).toHaveBeenCalledWith(userId);
  });

  it("does not delete the account if storage cleanup fails", async () => {
    const userId = "7bafac91-b9a9-49a3-b933-4268998558de";
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
      from: () => createQuery({
        data: [{ id: "cb92c60c-84a0-43e7-8181-83df42af2212", storage_path: "private/audio.wav" }],
        error: null,
      }),
    });
    const rpc = vi.fn();
    const deleteUser = vi.fn();
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn(() => createQuery({ error: null })),
      storage: { from: vi.fn(() => ({ remove: async () => ({ error: new Error("storage unavailable") }) })) },
      rpc,
      auth: { admin: { deleteUser } },
    });

    const response = await POST(jsonRequest({ confirmation: "DELETE" }));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://minutemate.test/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
