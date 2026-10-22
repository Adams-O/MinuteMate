import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SearchQuerySchema = z.string().trim().min(2).max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const SearchResultsSchema = z.array(z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(["uploading", "processing", "ready", "failed"]),
  created_at: z.string(),
})).max(50);

export async function GET(request: Request) {
  const query = SearchQuerySchema.safeParse(new URL(request.url).searchParams.get("q"));
  if (!query.success) {
    return Response.json({ error: "Enter a search term between 2 and 100 characters." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "Meeting search is not available yet." }, { status: 503 });
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Sign in before searching meetings." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("search_meetings", { p_query: query.data });
  if (error) {
    return Response.json({ error: "Meetings could not be searched." }, { status: 500 });
  }
  const results = SearchResultsSchema.safeParse(data);
  if (!results.success) {
    return Response.json({ error: "Meeting search returned invalid data." }, { status: 500 });
  }

  return Response.json({ meetings: results.data }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
