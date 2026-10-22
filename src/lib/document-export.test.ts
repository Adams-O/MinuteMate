import { describe, expect, it, vi } from "vitest";
import { renderMeetingDocx, renderMeetingPdf } from "@/lib/document-export";
import type { MeetingContent } from "@/lib/meeting-content";

vi.mock("server-only", () => ({}));

const content: MeetingContent = {
  meeting: {
    id: "cb92c60c-84a0-43e7-8181-83df42af2212",
    title: "Café launch planning 東京",
    status: "ready",
  },
  minutes: {
    summary: "The team planned the launch.",
    key_points: ["Prepare the release notes."],
    decisions: ["Review the launch on Friday."],
  },
  actionItems: [{
    id: "e2dc4f34-e58f-4d4a-a214-44e239385c1c",
    task: "Prepare the release notes.",
    owner: "Alex",
    deadline: "Friday",
    priority: "high",
    status: "open",
  }],
};

describe("meeting document exports", () => {
  it("generates a Unicode-capable PDF document", async () => {
    const bytes = await renderMeetingPdf(content);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("generates a Word Open XML document", async () => {
    const bytes = await renderMeetingDocx(content);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
