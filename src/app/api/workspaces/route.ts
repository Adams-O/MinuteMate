import { z } from "zod";
import { readBoundedBodyText } from "@/lib/request-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/origin";
import { enforceUserRateLimit } from "@/lib/rate-limit";

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const MAX_BODY_BYTES = 2048;

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Workspaces are not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to view workspaces." }, { status: 401 });

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: "Workspaces could not be loaded." }, { status: 503 });
  return Response.json({ workspaces: data ?? [] }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const bodyText = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (bodyText === null) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = CreateWorkspaceSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Workspace name is invalid." }, { status: 400 });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Workspaces are not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Sign in to create a workspace." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit({
    namespace: "workspace:create",
    userId: user.id,
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimit) return rateLimit;

  const { data, error } = await supabase.rpc("create_workspace", { p_name: input.data.name });
  if (error) {
    if (error.message.includes("Workspace limit reached")) {
      return Response.json({ error: "This account has reached the workspace limit." }, { status: 409 });
    }
    return Response.json({ error: "The workspace could not be created." }, { status: 503 });
  }
  return Response.json({ workspaceId: data }, { status: 201 });
}
