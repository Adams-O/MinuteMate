import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMinutesFromTranscript,
  InvalidMinutesOutputError,
} from "@/lib/ai/generate-minutes";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mocks.create };

    constructor() {}
  },
}));

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("CLAUDE_MODEL", "test-claude-model");
  mocks.create.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateMinutesFromTranscript", () => {
  it("returns schema-validated minutes and sends transcript-only grounding rules", async () => {
    mocks.create.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          summary: "The team reviewed the launch.",
          key_points: ["The launch review happened."],
          decisions: [],
          action_items: [{
            task: "Share the launch checklist.",
            owner: "Not stated",
            deadline: "Not stated",
            priority: "Not stated",
            status: "open",
          }],
        }),
      }],
    });

    await expect(generateMinutesFromTranscript("The team reviewed the launch."))
      .resolves.toMatchObject({
        action_items: [{ owner: "Not stated", deadline: "Not stated" }],
      });

    const request = mocks.create.mock.calls[0][0];
    expect(request.system).toContain("Never invent attendees, numbers, decisions, owners, deadlines, or priorities.");
    expect(request.messages[0].content).toContain("The team reviewed the launch.");
    expect(request.max_tokens).toBe(4096);
  });

  it("retries invalid JSON once and then surfaces a safe validation error", async () => {
    mocks.create
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not-json" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "still-not-json" }] });

    await expect(generateMinutesFromTranscript("Transcript text"))
      .rejects.toBeInstanceOf(InvalidMinutesOutputError);

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
