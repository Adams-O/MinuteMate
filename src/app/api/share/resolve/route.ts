import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { resolveShareToken } from "@/lib/share-links";

const ShareRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function POST(request: Request) {
  const bodyText = await readBoundedBodyText(request, 1024);
  if (bodyText === null) return Response.json({ error: "Share link is invalid." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Share link is invalid." }, { status: 400 });
  }
  const input = ShareRequestSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Share link is invalid." }, { status: 400 });

  const result = await resolveShareToken(input.data.token);
  if (result.kind === "invalid" || result.kind === "not_found") {
    return Response.json({ error: "This share link is invalid, expired, or revoked." }, { status: 404 });
  }
  if (result.kind === "unavailable") {
    return Response.json({ error: "This shared meeting is temporarily unavailable." }, { status: 503 });
  }
  return Response.json({
    content: result.content,
    expiresAt: result.expiresAt,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
