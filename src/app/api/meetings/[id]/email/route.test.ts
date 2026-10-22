import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/meetings/[id]/email/route";

const mocks = vi.hoisted(() => ({
  getOwnedMeetingContent: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/meeting-content", () => ({
  getOwnedMeetingContent: mocks.getOwnedMeetingContent,
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
    constructor() {}
  },
}));

const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";
const content = {
  meeting: { id: MEETING_ID, title: "Private planning", status: "ready" },
  minutes: {
    summary: "The team planned a launch.",
    key_points: ["Prepare release notes."],
    decisions: ["Launch next week."],
  },
  actionItems: [{
    id: "7bafac91-b9a9-49a3-b933-4268998558de",
    task: "Prepare release notes.",
    owner: "Alex",
    deadline: "Friday",
    priority: "high",
    status: "open",
  }],
};

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "minutes@example.test");
  mocks.getOwnedMeetingContent.mockReset();
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ error: null });
});

describe("POST /api/meetings/[id]/email", () => {
  it("requires explicit confirmation and valid recipients", async () => {
    const response = await POST(jsonRequest({ confirmed: false, recipients: ["attendee@example.test"] }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(400);
    expect(mocks.getOwnedMeetingContent).not.toHaveBeenCalled();
  });

  it("does not email data when the meeting is not owned", async () => {
    mocks.getOwnedMeetingContent.mockResolvedValue({ kind: "not_found" });
    const response = await POST(jsonRequest({ confirmed: true, recipients: ["attendee@example.test"] }), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends only minutes and hides additional recipients with BCC", async () => {
    mocks.getOwnedMeetingContent.mockResolvedValue({
      kind: "ready",
      content,
      userId: "7bafac91-b9a9-49a3-b933-4268998558de",
    });
    const response = await POST(jsonRequest({
      confirmed: true,
      recipients: ["one@example.test", "two@example.test"],
    }), { params: Promise.resolve({ id: MEETING_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true, recipientCount: 2 });
    const email = mocks.send.mock.calls[0][0];
    expect(email.to).toBe("one@example.test");
    expect(email.bcc).toEqual(["two@example.test"]);
    expect(email.text).toContain("The team planned a launch.");
    expect(email.text).not.toContain("transcript");
  });
});

function jsonRequest(value: unknown): Request {
  return new Request(`https://minutemate.test/api/meetings/${MEETING_ID}/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
