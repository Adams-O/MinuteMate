"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { MeetingStatusSchema } from "@/lib/schemas";

const ResultsSchema = z.array(z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: MeetingStatusSchema,
  created_at: z.string(),
})).max(50);

type Result = z.infer<typeof ResultsSchema>[number];

export function MeetingSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(`/api/meetings/search?q=${encodeURIComponent(query)}`);
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(body);
        setError(message.success ? message.data.error : "Meetings could not be searched.");
        return;
      }
      const parsed = z.object({ meetings: ResultsSchema }).safeParse(body);
      if (!parsed.success) {
        setError("Meeting search returned invalid data.");
        return;
      }
      setResults(parsed.data.meetings);
    } catch {
      setError("Meetings could not be searched. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
      <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="meeting-search">Search meetings</label>
        <input
          id="meeting-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={100}
          placeholder="Search titles, minutes, transcripts, and action items"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Searching..." : "Search"}
        </button>
        {results ? (
          <button
            type="button"
            onClick={() => { setQuery(""); setResults(null); }}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
          >
            Clear
          </button>
        ) : null}
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {results ? (
        <div className="mt-4" aria-live="polite">
          {results.length ? (
            <ul className="space-y-2">
              {results.map((meeting) => (
                <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3">
                  <div>
                    <Link href={`/meetings/${meeting.id}`} className="font-medium text-sky-200 hover:underline">
                      {meeting.title}
                    </Link>
                    <p className="mt-1 text-xs text-slate-400">{new Date(meeting.created_at).toLocaleString()}</p>
                  </div>
                  <span className="text-xs capitalize text-slate-400">{meeting.status}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">No matching meetings found.</p>}
        </div>
      ) : null}
    </section>
  );
}
