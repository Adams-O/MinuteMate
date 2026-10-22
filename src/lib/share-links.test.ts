import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashShareToken, resolveShareToken } from "@/lib/share-links";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

const TOKEN = "a".repeat(43);
const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

describe("resolveShareToken", () => {
  it("rejects malformed tokens without querying storage", async () => {
    await expect(resolveShareToken("not-a-token")).resolves.toEqual({ kind: "invalid" });
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("resolves an unexpired share to minutes and action items without transcript or audio", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({
          data: { id: "share-1", meeting_id: MEETING_ID, expires_at: "2026-10-23T02:00:00.000Z" },
          error: null,
        }))
        .mockReturnValueOnce(createQuery({
          data: {
            title: "Launch",
            status: "ready",
            minutes: {
              summary: "A launch was planned.",
              key_points: ["Prepare a checklist."],
              decisions: [],
            },
            action_items: [{
              id: "e2dc4f34-e58f-4d4a-a214-44e239385c1c",
              task: "Prepare a checklist.",
              owner: "Not stated",
              deadline: "Not stated",
              priority: null,
              status: "open",
            }],
          },
          error: null,
        })),
    });

    const result = await resolveShareToken(TOKEN);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected resolved share");
    expect(result.content.title).toBe("Launch");
    expect(result.content.actionItems).toHaveLength(1);
    expect(result).not.toHaveProperty("transcript");
    expect(result).not.toHaveProperty("storage_path");
  });

  it("uses a one-way SHA-256 token hash", () => {
    const hash = hashShareToken(TOKEN);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(TOKEN);
  });
});
