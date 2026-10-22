import { describe, expect, it } from "vitest";
import { requireSameOrigin } from "@/lib/origin";

describe("requireSameOrigin", () => {
  it("allows same-origin and non-browser requests", () => {
    expect(requireSameOrigin(new Request("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://app.example.test" },
    }))).toBeNull();
    expect(requireSameOrigin(new Request("https://app.example.test/api/action", { method: "POST" }))).toBeNull();
  });

  it("rejects cross-site browser requests and malformed origins", async () => {
    const crossSite = requireSameOrigin(new Request("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }));
    expect(crossSite?.status).toBe(403);
    const malformed = requireSameOrigin(new Request("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "not-an-origin" },
    }));
    expect(malformed?.status).toBe(403);
  });
});
