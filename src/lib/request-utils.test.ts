import { describe, expect, it } from "vitest";
import { readBoundedBodyText } from "@/lib/request-utils";

describe("readBoundedBodyText", () => {
  it("reads a body within its byte limit", async () => {
    const request = new Request("https://example.test", { body: '{"ok":true}', method: "POST" });

    await expect(readBoundedBodyText(request, 32)).resolves.toBe('{"ok":true}');
  });

  it("rejects a body that exceeds its byte limit", async () => {
    const request = new Request("https://example.test", { body: "0123456789", method: "POST" });

    await expect(readBoundedBodyText(request, 8)).resolves.toBeNull();
  });

  it("rejects malformed UTF-8", async () => {
    const request = new Request("https://example.test", {
      body: new Uint8Array([0xff]),
      method: "POST",
    });

    await expect(readBoundedBodyText(request, 8)).resolves.toBeNull();
  });
});
