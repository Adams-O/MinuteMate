import { z } from "zod";
import { CreateShareInputSchema } from "@/lib/schemas";
import { readBoundedBodyText } from "@/lib/request-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createShareToken, hashShareToken } from "@/lib/share-links";
import { requireSameOrigin } from "@/lib/origin";
import { enforceUserRateLimit } from "@/lib/rate-limit";

const MeetingIdSchema = z.string().uuid();
const ShareIdSchema = z.object({ shareId: z.string().uuid() });
const ShareRecordSchema = z.object({
  id: z.string().uuid(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
const MAX_BODY_BYTES = 2048;

type AuthorizedMeeting =
  | { kind: "ok"; admin: ReturnType<typeof createSupabaseAdminClient>; userId: string }
  | { kind: "unauthenticated" | "unavailable" | "not_found" | "not_ready" };

async function authorizeMeeting(meetingId: string): Promise<AuthorizedMeeting> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { kind: "unavailable" };
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { kind: "unauthenticated" };

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { kind: "unavailable" };
  }
  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) return { kind: "unavailable" };
  if (!meeting) return { kind: "not_found" };
  if (meeting.status !== "ready") return { kind: "not_ready" };
  return { kind: "ok", admin, userId: user.id };
}

function errorResponse(kind: Exclude<AuthorizedMeeting["kind"], "ok">) {
  if (kind === "unauthenticated") return Response.json({ error: "Sign in to manage share links." }, { status: 401 });
  if (kind === "not_found") return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (kind === "not_ready") return Response.json({ error: "Only completed meetings can be shared." }, { status: 409 });
  return Response.json({ error: "Share links are not available yet." }, { status: 503 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) return Response.json({ error: "Meeting not found." }, { status: 404 });
  const authorized = await authorizeMeeting(id);
  if (authorized.kind !== "ok") return errorResponse(authorized.kind);

  const { data, error } = await authorized.admin.from("meeting_shares")
    .select("id, expires_at, revoked_at, created_at")
    .eq("meeting_id", id)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: "Share links could not be loaded." }, { status: 503 });
  const shares = z.array(ShareRecordSchema).safeParse(data ?? []);
  if (!shares.success) return Response.json({ error: "Share link data is unavailable." }, { status: 503 });
  return Response.json({ shares: shares.data }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) return Response.json({ error: "Meeting not found." }, { status: 404 });
  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = CreateShareInputSchema.safeParse(rawBody);
  if (!input.success) return Response.json({ error: "Choose an expiry between 1 hour and 30 days." }, { status: 400 });

  const authorized = await authorizeMeeting(id);
  if (authorized.kind !== "ok") return errorResponse(authorized.kind);
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:share",
    userId: authorized.userId,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;
  const appUrl = z.string().url().safeParse(process.env.NEXT_PUBLIC_APP_URL);
  if (!appUrl.success) return Response.json({ error: "Share links are not configured." }, { status: 503 });
  const baseUrl = new URL(appUrl.data);
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    return Response.json({ error: "Share links require a secure application URL." }, { status: 503 });
  }

  const token = createShareToken();
  const expiresAt = new Date(Date.now() + input.data.expiresInHours * 60 * 60 * 1000).toISOString();
  const { data: share, error } = await authorized.admin.from("meeting_shares")
    .insert({
      meeting_id: id,
      token_hash: hashShareToken(token),
      expires_at: expiresAt,
    })
    .select("id, expires_at, revoked_at, created_at")
    .single();
  const parsedShare = ShareRecordSchema.safeParse(share);
  if (error || !parsedShare.success) return Response.json({ error: "A share link could not be created." }, { status: 503 });

  const shareUrl = new URL("/share", baseUrl.origin);
  shareUrl.hash = token;
  return Response.json({ share: { ...parsedShare.data, url: shareUrl.toString() } }, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  if (!MeetingIdSchema.safeParse(id).success) return Response.json({ error: "Meeting not found." }, { status: 404 });
  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = ShareIdSchema.safeParse(rawBody);
  if (!input.success) return Response.json({ error: "Share link is invalid." }, { status: 400 });

  const authorized = await authorizeMeeting(id);
  if (authorized.kind !== "ok") return errorResponse(authorized.kind);
  const rateLimit = await enforceUserRateLimit({
    namespace: "meeting:share",
    userId: authorized.userId,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;
  const { data, error } = await authorized.admin.from("meeting_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.data.shareId)
    .eq("meeting_id", id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: "Share link could not be revoked." }, { status: 503 });
  if (!data) return Response.json({ error: "Share link not found or already revoked." }, { status: 404 });
  return Response.json({ revoked: true }, { headers: { "Cache-Control": "private, no-store" } });
}
