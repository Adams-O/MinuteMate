import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateMeetingInputSchema } from "@/lib/schemas";
import { getFreePlanLimits } from "@/lib/billing-limits";
import { readBoundedBodyText } from "@/lib/request-utils";
import { enforceUserRateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const STORAGE_BUCKET = "meeting-audio";
const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/x-m4a",
  mp4: "video/mp4",
  webm: "audio/webm",
};
const AllowedWorkspaceSchema = z.array(z.object({ workspace_id: z.string().uuid() }));

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let rawInput: unknown;
  try {
    rawInput = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = CreateMeetingInputSchema.safeParse(rawInput);
  if (!input.success) return Response.json({ error: "Meeting details are invalid." }, { status: 400 });
  const { title, sourceType, fileName, sizeBytes, durationSeconds } = input.data;
  if (!fileName || !sizeBytes || sizeBytes > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "File details are missing or exceed the 100 MB limit." }, { status: 400 });
  }
  if (sourceType === "recording" && durationSeconds === undefined) {
    return Response.json({ error: "Recording duration is required." }, { status: 400 });
  }
  const extension = fileName.split(".").pop()?.toLowerCase();
  const allowedExtensions = sourceType === "recording" ? ["mp3", "wav", "m4a", "mp4", "webm"] : ["mp3", "wav", "m4a", "mp4"];
  if (!extension || !allowedExtensions.includes(extension)) {
    return Response.json({ error: "This meeting file type is not supported." }, { status: 400 });
  }
  const contentType = MIME_TYPES[extension];
  if (!contentType) return Response.json({ error: "This meeting file type is not supported." }, { status: 400 });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Meeting uploads are not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in before uploading a meeting." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:create",
    userId: user.id,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const freePlanLimits = getFreePlanLimits();
  if (!freePlanLimits) return Response.json({ error: "Meeting usage limits are not configured." }, { status: 503 });

  let membershipQuery = supabase.from("workspace_members").select("workspace_id").eq("user_id", user.id);
  if (input.data.workspaceId) membershipQuery = membershipQuery.eq("workspace_id", input.data.workspaceId);
  const { data: memberships, error: membershipError } = await membershipQuery
    .order("created_at", { ascending: true })
    .limit(1);
  const allowedWorkspaces = AllowedWorkspaceSchema.safeParse(memberships ?? []);
  if (membershipError || !allowedWorkspaces.success) {
    return Response.json({ error: "A workspace could not be selected for this meeting." }, { status: 503 });
  }
  const workspaceId = allowedWorkspaces.data[0]?.workspace_id;
  if (!workspaceId) return Response.json({ error: "Create or join a workspace before uploading a meeting." }, { status: 409 });

  const meetingId = randomUUID();
  const storagePath = `${user.id}/${meetingId}/${meetingId}.${extension}`;
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({ error: "Meeting uploads are not available yet." }, { status: 503 });
  }
  const { error: createError } = await admin.rpc("create_meeting_with_usage", {
    p_user_id: user.id,
    p_workspace_id: workspaceId,
    p_meeting_id: meetingId,
    p_title: title,
    p_source_type: sourceType,
    p_storage_path: storagePath,
    p_audio_retention: input.data.audioRetention,
    p_size_bytes: sizeBytes,
    p_duration_seconds: durationSeconds ?? null,
    p_max_meetings: freePlanLimits.meetings,
    p_max_audio_seconds: freePlanLimits.audioSeconds,
  });
  if (createError) {
    if (createError.message.includes("monthly limit")) {
      return Response.json({ error: "This workspace has reached its monthly meeting limit." }, { status: 402 });
    }
    return Response.json({ error: "The meeting could not be created." }, { status: 503 });
  }

  const { data: upload, error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (uploadError || !upload?.token) {
    await admin.from("meetings").delete().eq("id", meetingId).eq("owner_id", user.id);
    return Response.json({ error: "A secure upload could not be authorized." }, { status: 503 });
  }

  return Response.json({
    meetingId,
    bucket: STORAGE_BUCKET,
    path: storagePath,
    token: upload.token,
    contentType,
  }, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
