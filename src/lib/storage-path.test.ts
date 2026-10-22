import { describe, expect, it } from "vitest";
import { isMeetingStoragePath } from "@/lib/storage-path";

const OWNER_ID = "7bafac91-b9a9-49a3-b933-4268998558de";
const MEETING_ID = "cb92c60c-84a0-43e7-8181-83df42af2212";

describe("isMeetingStoragePath", () => {
  it("accepts a path scoped to the expected owner and meeting", () => {
    expect(isMeetingStoragePath(OWNER_ID, MEETING_ID, `${OWNER_ID}/${MEETING_ID}/${MEETING_ID}.wav`)).toBe(true);
  });

  it("rejects another user's path, another meeting, or nested paths", () => {
    expect(isMeetingStoragePath(OWNER_ID, MEETING_ID, `another-user/${MEETING_ID}/${MEETING_ID}.wav`)).toBe(false);
    expect(isMeetingStoragePath(OWNER_ID, MEETING_ID, `${OWNER_ID}/other-meeting/${MEETING_ID}.wav`)).toBe(false);
    expect(isMeetingStoragePath(OWNER_ID, MEETING_ID, `${OWNER_ID}/${MEETING_ID}/nested/audio.wav`)).toBe(false);
  });
});
