import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BillingPanel } from "@/components/billing-panel";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function BillingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen px-5 py-10 text-slate-300">Loading billing...</main>}>
      <BillingWorkspace />
    </Suspense>
  );
}

async function BillingWorkspace() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-50">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-sm text-sky-300 hover:text-sky-200">Back to meetings</Link>
        <header>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Billing</p>
          <h1 className="mt-2 text-3xl font-semibold">Plan and usage</h1>
        </header>
        {error ? (
          <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
            Billing workspaces could not be loaded.
          </p>
        ) : <BillingPanel workspaces={workspaces ?? []} />}
      </div>
    </main>
  );
}
