import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = requestUrl.searchParams.get("next") === "/invitations/accept"
    ? "/invitations/accept"
    : "/";

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return Response.redirect(new URL(nextPath, request.url));
      }
    } catch {
      // Redirect with a generic error instead of exposing auth provider details.
    }
  }

  return Response.redirect(new URL("/login?error=auth_callback", request.url));
}