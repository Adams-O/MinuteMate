import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "@/lib/sentry";

describe("scrubSentryEvent", () => {
  it("removes request, identity, breadcrumbs, and error messages", () => {
    const event = {
      message: "Private meeting text",
      request: { url: "https://example.test/path?token=secret", headers: { authorization: "secret" } },
      user: { id: "private-user" },
      extra: { transcript: "private transcript" },
      contexts: { app: { content: "private content" } },
      breadcrumbs: [{ message: "private transcript breadcrumb" }],
      exception: { values: [{ value: "signed URL private text", stacktrace: { frames: [{
        vars: { transcript: "private text" },
        context_line: "private line",
        pre_context: ["private before"],
        post_context: ["private after"],
        filename: "src/api.ts",
      }] } }] },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.message).toBeUndefined();
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toEqual([]);
    expect(scrubbed.exception?.values?.[0].value).toBe("[redacted]");
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({ filename: "src/api.ts" });
  });
});
