import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkRateLimit", () => {
  it("fails closed when the Upstash service is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(checkRateLimit({
      namespace: "meeting:create",
      subject: "account-id",
      limit: 10,
      windowSeconds: 60,
    })).resolves.toEqual({ kind: "unavailable" });
  });

  it("returns allowed and limited results from Redis atomically", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ result: [4, 12] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ result: [6, 12] }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      namespace: "meeting:create",
      subject: "user-id",
      limit: 5,
      windowSeconds: 60,
    };

    await expect(checkRateLimit(request)).resolves.toEqual({ kind: "allowed" });
    await expect(checkRateLimit(request)).resolves.toEqual({ kind: "limited", retryAfterSeconds: 12 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns no-store 429 with a Retry-After header", () => {
    const response = rateLimitResponse({ kind: "limited", retryAfterSeconds: 17 });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("17");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});
