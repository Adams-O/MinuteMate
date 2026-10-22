import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

const UpstashResultSchema = z.array(z.object({
  result: z.tuple([z.number().int().nonnegative(), z.number().int()]),
}));
const RATE_LIMIT_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  "return {count, redis.call('TTL', KEYS[1])}",
].join("\n");

export type RateLimitResult =
  | { kind: "allowed" }
  | { kind: "limited"; retryAfterSeconds: number }
  | { kind: "unavailable" };

export async function checkRateLimit(input: {
  namespace: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  if (
    !/^[a-z0-9:_-]{1,80}$/i.test(input.namespace) ||
    typeof input.subject !== "string" || input.subject.length < 1 ||
    !Number.isSafeInteger(input.limit) || input.limit < 1 ||
    !Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 1
  ) {
    return { kind: "unavailable" };
  }

  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) {
    return process.env.NODE_ENV === "production" ? { kind: "unavailable" } : { kind: "allowed" };
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/pipeline", baseUrl);
  } catch {
    return { kind: "unavailable" };
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
    return { kind: "unavailable" };
  }

  const subjectHash = createHash("sha256").update(input.subject).digest("hex");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([[
        "EVAL",
        RATE_LIMIT_SCRIPT,
        "1",
        `minutemate:rate:${input.namespace}:${subjectHash}`,
        String(input.windowSeconds),
      ]]),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok) return { kind: "unavailable" };

  const raw: unknown = await response.json().catch(() => null);
  const result = UpstashResultSchema.safeParse(raw);
  if (!result.success) return { kind: "unavailable" };
  const [count, ttl] = result.data[0].result;
  return count > input.limit
    ? { kind: "limited", retryAfterSeconds: Math.max(1, ttl) }
    : { kind: "allowed" };
}

export function rateLimitResponse(result: RateLimitResult): Response | null {
  if (result.kind === "allowed") return null;
  if (result.kind === "limited") {
    return Response.json(
      { error: "Too many requests. Please wait before trying again." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(result.retryAfterSeconds),
        },
      },
    );
  }
  return Response.json(
    { error: "This operation is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function enforceUserRateLimit(input: {
  namespace: string;
  userId: string;
  limit: number;
  windowSeconds: number;
}): Promise<Response | null> {
  const result = await checkRateLimit({
    namespace: input.namespace,
    subject: input.userId,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
  });
  return rateLimitResponse(result);
}
