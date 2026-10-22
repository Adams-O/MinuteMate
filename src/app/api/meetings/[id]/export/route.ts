import { z } from "zod";
import { getOwnedMeetingContent } from "@/lib/meeting-content";
import { renderMeetingDocx, renderMeetingPdf } from "@/lib/document-export";
import { enforceUserRateLimit } from "@/lib/rate-limit";

const MeetingIdSchema = z.string().uuid();
const ExportFormatSchema = z.enum(["pdf", "docx"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  const format = ExportFormatSchema.safeParse(new URL(request.url).searchParams.get("format"));
  if (!format.success) {
    return Response.json({ error: "Choose PDF or Word format." }, { status: 400 });
  }

  const result = await getOwnedMeetingContent(id);
  if (result.kind === "unauthenticated") return Response.json({ error: "Sign in to export this meeting." }, { status: 401 });
  if (result.kind === "not_found") return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (result.kind === "not_ready") return Response.json({ error: "Only completed meetings can be exported." }, { status: 409 });
  if (result.kind === "unavailable") return Response.json({ error: "Meeting data could not be loaded." }, { status: 503 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:export",
    userId: result.userId,
    limit: 20,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  try {
    const bytes = format.data === "pdf"
      ? await renderMeetingPdf(result.content)
      : await renderMeetingDocx(result.content);
    const extension = format.data === "pdf" ? "pdf" : "docx";
    const mimeType = format.data === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="meeting-minutes.${extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Meeting export could not be generated." }, { status: 500 });
  }
}
