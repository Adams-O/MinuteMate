import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MeetingCapture } from "@/components/meeting-capture";
import { SignOutButton } from "@/components/sign-out-button";
import { MeetingSearch } from "@/components/meeting-search";
import { WorkspaceManager } from "@/components/workspace-manager";
import { MeetingRecordSchema } from "@/lib/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const WorkspaceSchema = MeetingRecordSchema.pick({ id: true }).extend({
  name: MeetingRecordSchema.shape.title,
});

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen px-6 py-12 text-slate-300">Loading your workspace...</main>}>
      <Workspace />
    </Suspense>
  );
}

async function Workspace() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: meetingRows, error: meetingsError } = await supabase
    .from("meetings")
    .select("id, title, status, created_at, duration_seconds, failure_code, audio_retention, audio_deletion_status")
    .order("created_at", { ascending: false });
  const { data: workspaceRows, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });

  const parsedMeetings = MeetingRecordSchema.array().safeParse(meetingRows ?? []);
  const meetings = parsedMeetings.success ? parsedMeetings.data : [];
  const parsedWorkspaces = WorkspaceSchema.array().safeParse(workspaceRows ?? []);
  const workspaces = parsedWorkspaces.success ? parsedWorkspaces.data : [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="MinuteMate home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 font-bold text-slate-950">M</span>
          <span>
            <span className="block text-lg font-semibold">MinuteMate</span>
            <span className="block text-xs text-slate-400">Meeting intelligence</span>
          </span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-4">
          <Link href="/billing" className="text-sm text-sky-300 hover:text-sky-200">Billing</Link>
          <Link href="/settings/privacy" className="text-sm text-sky-300 hover:text-sky-200">Data controls</Link>
          <SignOutButton />
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 pb-12 pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pt-12">
        <div className="space-y-8">
          <p className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-200">
            Private workspace
          </p>
          <div className="space-y-5">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Turn every meeting into a clean summary and action plan.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-300">
              Record or upload meetings, then review transcript-grounded minutes and action items in one private workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-slate-200">
            <span className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2">Private storage</span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2">Webhook processing</span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2">Transcript-grounded AI</span>
          </div>
        </div>
        <div id="capture" className="w-full">
          <MeetingCapture workspaces={workspaces} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-8 px-6 pb-20 lg:px-8">
        <WorkspaceManager workspaces={workspaces} />
        {workspaceError ? (
          <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            Workspace information could not be loaded.
          </p>
        ) : null}
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Your workspace</p>
          <h2 className="mt-3 text-3xl font-semibold text-white">Meetings</h2>
        </div>
        <MeetingSearch />
        {meetingsError || !parsedMeetings.success ? (
          <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            Your meetings could not be loaded. Refresh the page to try again.
          </p>
        ) : meetings.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-300">
            No meetings yet. Record or upload one to get started.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="font-semibold text-white">{meeting.title}</h3>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs capitalize text-slate-300">
                    {meeting.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  {new Date(meeting.created_at).toLocaleString()}
                  {meeting.duration_seconds ? ` · ${Math.ceil(meeting.duration_seconds / 60)} min` : ""}
                </p>
                {meeting.status === "failed" ? (
                  <p className="mt-2 text-sm text-rose-300">Processing failed. Open the meeting for details.</p>
                ) : null}
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="mt-4 inline-flex rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-sky-300 hover:bg-slate-800"
                >
                  View meeting
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
