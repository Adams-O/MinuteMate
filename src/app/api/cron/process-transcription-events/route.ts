import { processNextAssemblyAIWebhook } from "@/lib/processing/assemblyai-webhook";
import { verifyAssemblyAIWebhookAuth } from "@/lib/meeting-utils";

export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "Scheduled processing is not configured." }, { status: 503 });
  }
  if (!verifyAssemblyAIWebhookAuth(request.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await processNextAssemblyAIWebhook();
    return Response.json({ result }, { status: 200 });
  } catch {
    return Response.json({ error: "Scheduled processing failed and will be retried." }, { status: 503 });
  }
}
