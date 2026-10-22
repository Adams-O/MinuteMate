import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/process-transcription-events/route";

const mocks = vi.hoisted(() => ({
  processNextAssemblyAIWebhook: vi.fn(),
}));

vi.mock("@/lib/processing/assemblyai-webhook", () => ({
  processNextAssemblyAIWebhook: mocks.processNextAssemblyAIWebhook,
}));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  mocks.processNextAssemblyAIWebhook.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/process-transcription-events", () => {
  it("rejects unauthorized scheduler requests", async () => {
    const response = await GET(new Request("https://minutemate.test"));
    expect(response.status).toBe(401);
    expect(mocks.processNextAssemblyAIWebhook).not.toHaveBeenCalled();
  });

  it("processes one durable job after scheduler authentication", async () => {
    mocks.processNextAssemblyAIWebhook.mockResolvedValue("processed");
    const response = await GET(new Request("https://minutemate.test", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "processed" });
  });

  it("returns a safe retryable error when queue processing fails", async () => {
    mocks.processNextAssemblyAIWebhook.mockRejectedValue(new Error("private provider detail"));
    const response = await GET(new Request("https://minutemate.test", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Scheduled processing failed and will be retried.",
    });
  });
});
