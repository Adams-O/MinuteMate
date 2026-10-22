import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaystackSignature } from "@/lib/paystack";

describe("verifyPaystackSignature", () => {
  it("verifies a valid raw-body HMAC-SHA512 signature", () => {
    const body = '{"event":"charge.success"}';
    const signature = createHmac("sha512", "test-secret").update(body).digest("hex");
    expect(verifyPaystackSignature(body, signature, "test-secret")).toBe(true);
  });

  it("rejects malformed, altered, or wrong-key signatures", () => {
    const body = '{"event":"charge.success"}';
    const signature = createHmac("sha512", "test-secret").update(body).digest("hex");
    expect(verifyPaystackSignature(body, null, "test-secret")).toBe(false);
    expect(verifyPaystackSignature(body, "invalid", "test-secret")).toBe(false);
    expect(verifyPaystackSignature(`${body} `, signature, "test-secret")).toBe(false);
    expect(verifyPaystackSignature(body, signature, "wrong-secret")).toBe(false);
  });
});
