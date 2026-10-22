import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/assemblyai/route";
import { createQuery } from "@/test/query-builder";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";
const JOB_ID = "assembly-job-1";
const SECRET = "assemblyai-shared-secret";

beforeEach(() => {
  vi.stubEnv("ASSEMBLYAI_WEBHOOK_SECRET", SECRET);
  mocks.createSupabaseAdminClient.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/assemblyai", () => {
  it("rejects requests without the configured provider authentication header", async () => {
    const response = await POST(webhookRequest({ transcript_id: JOB_ID, status: "completed" }, null));
    expect(response.status).toBe(401);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed event bodies", async () => {
    const response = await POST(webhookRequest("{", SECRET));
    expect(response.status).toBe(400);
  });

  it("persists a valid callback to the durable queue and returns promptly", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({
          data: { id: MEETING_ID, status: "processing", transcription_job_id: JOB_ID },
          error: null,
        }))
        .mockReturnValueOnce(createQuery({ error: null })),
    });

    const response = await POST(webhookRequest(
      { transcript_id: JOB_ID, status: "completed" },
      SECRET,
    ));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true, queued: true });
  });

  it("treats a matching duplicate callback as idempotent", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(createQuery({
          data: { id: MEETING_ID, status: "processing", transcription_job_id: JOB_ID },
          error: null,
        }))
        .mockReturnValueOnce(createQuery({ error: { code: "23505" } }))
        .mockReturnValueOnce(createQuery({
          data: { meeting_id: MEETING_ID, event_status: "completed" },
          error: null,
        })),
    });

    const response = await POST(webhookRequest(
      { transcript_id: JOB_ID, status: "completed" },
      SECRET,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
  });

  it("rejects callbacks that do not match the meeting's provider job", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: () => createQuery({
        data: { id: MEETING_ID, status: "processing", transcription_job_id: "expected-job" },
        error: null,
      }),
    });

    const response = await POST(webhookRequest(
      { transcript_id: JOB_ID, status: "completed" },
      SECRET,
    ));
    expect(response.status).toBe(400);
  });

  it("bounds webhook body size before parsing", async () => {
    const response = await POST(webhookRequest("x".repeat(9000), SECRET));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

function webhookRequest(
  body: unknown,
  secret: string | null,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret) headers.set("x-minutemate-webhook-secret", secret);
  return new Request(
    `https://minutemate.test/api/webhooks/assemblyai?meetingId=${MEETING_ID}`,
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}
