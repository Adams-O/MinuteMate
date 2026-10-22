import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/share/resolve/route";

const mocks = vi.hoisted(() => ({
  resolveShareToken: vi.fn(),
}));

vi.mock("@/lib/share-links", () => ({
  resolveShareToken: mocks.resolveShareToken,
}));

beforeEach(() => mocks.resolveShareToken.mockReset());

describe("POST /api/share/resolve", () => {
  it("rejects malformed tokens without attempting resolution", async () => {
    const response = await POST(jsonRequest({ token: "short" }));
    expect(response.status).toBe(400);
    expect(mocks.resolveShareToken).not.toHaveBeenCalled();
  });

  it("returns only validated minutes and action items without caching", async () => {
    mocks.resolveShareToken.mockResolvedValue({
      kind: "ready",
      expiresAt: "2026-10-23T02:00:00.000Z",
      content: {
        title: "Project review",
        minutes: { summary: "The project is on track.", key_points: ["Finish testing."], decisions: [] },
        actionItems: [],
      },
    });
    const response = await POST(jsonRequest({ token: "a".repeat(43) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json() as Record<string, unknown>;
    expect(body).toHaveProperty("content.minutes");
    expect(body).not.toHaveProperty("content.transcript");
    expect(body).not.toHaveProperty("content.audio");
  });

  it("does not expose share contents after revocation or expiry", async () => {
    mocks.resolveShareToken.mockResolvedValue({ kind: "not_found" });
    const response = await POST(jsonRequest({ token: "a".repeat(43) }));
    expect(response.status).toBe(404);
    expect(mocks.resolveShareToken).toHaveBeenCalledOnce();
  });
});

function jsonRequest(value: unknown): Request {
  return new Request("https://minutemate.test/api/share/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
