import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/meetings/[id]/export/route";

const mocks = vi.hoisted(() => ({
  getOwnedMeetingContent: vi.fn(),
  renderMeetingDocx: vi.fn(),
  renderMeetingPdf: vi.fn(),
}));

vi.mock("@/lib/meeting-content", () => ({
  getOwnedMeetingContent: mocks.getOwnedMeetingContent,
}));
vi.mock("@/lib/document-export", () => ({
  renderMeetingDocx: mocks.renderMeetingDocx,
  renderMeetingPdf: mocks.renderMeetingPdf,
}));

const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

beforeEach(() => {
  mocks.getOwnedMeetingContent.mockReset();
  mocks.renderMeetingDocx.mockReset();
  mocks.renderMeetingPdf.mockReset();
});

describe("GET /api/meetings/[id]/export", () => {
  it("rejects unsupported formats", async () => {
    const response = await GET(new Request("https://minutemate.test/export?format=html"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(400);
  });

  it("does not export meetings the user cannot access", async () => {
    mocks.getOwnedMeetingContent.mockResolvedValue({ kind: "not_found" });
    const response = await GET(new Request("https://minutemate.test/export?format=pdf"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(404);
    expect(mocks.renderMeetingPdf).not.toHaveBeenCalled();
  });

  it("returns a private PDF attachment", async () => {
    mocks.getOwnedMeetingContent.mockResolvedValue({
      kind: "ready",
      content: {},
      userId: "7bafac91-b9a9-49a3-b933-4268998558de",
    });
    mocks.renderMeetingPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const response = await GET(new Request("https://minutemate.test/export?format=pdf"), {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("meeting-minutes.pdf");
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([37, 80, 68, 70]).buffer);
  });
});
