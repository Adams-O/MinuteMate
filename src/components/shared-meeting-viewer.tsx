"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { SharedMeetingContentSchema } from "@/lib/schemas";

const SharedResponseSchema = z.object({
  content: SharedMeetingContentSchema,
  expiresAt: z.string(),
});

export function SharedMeetingViewer() {
  const [content, setContent] = useState<z.infer<typeof SharedMeetingContentSchema> | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(window.history.state, "", "/share");
    const controller = new AbortController();
    const isValidToken = /^[A-Za-z0-9_-]{43}$/.test(token);
    const request = isValidToken
      ? fetch("/api/share/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        })
      : Promise.reject(new Error("Invalid share link"));

    void request.then(async (response) => {
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const parsedError = z.object({ error: z.string() }).safeParse(body);
        setError(parsedError.success ? parsedError.data.error : "This shared meeting is unavailable.");
        return;
      }
      const parsed = SharedResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError("This shared meeting returned invalid data.");
        return;
      }
      if (controller.signal.aborted) return;
      setContent(parsed.data.content);
      setExpiresAt(parsed.data.expiresAt);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setError(isValidToken
        ? "This shared meeting is temporarily unavailable."
        : "This share link is invalid, expired, or revoked.");
    });
    return () => controller.abort();
  }, []);

  if (error) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-100">{error}</main>;
  }
  if (!content || !expiresAt) {
    return <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-slate-300" role="status">Loading shared meeting...</main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-5 py-12 text-slate-100 sm:px-8">
      <header className="border-b border-slate-800 pb-6">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">MinuteMate · Shared minutes</p>
        <h1 className="mt-3 text-3xl font-semibold">{content.title}</h1>
        <p className="mt-3 text-sm text-slate-400">
          Read-only link expires {new Date(expiresAt).toISOString()}.
        </p>
      </header>
      <section>
        <h2 className="text-xl font-semibold">Summary</h2>
        <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-300">{content.minutes.summary}</p>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Key points</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
          {content.minutes.key_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Decisions</h2>
        {content.minutes.decisions.length ? (
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
            {content.minutes.decisions.map((decision, index) => <li key={`${index}-${decision}`}>{decision}</li>)}
          </ul>
        ) : <p className="mt-3 text-slate-400">No decisions recorded.</p>}
      </section>
      <section>
        <h2 className="text-xl font-semibold">Action items</h2>
        {content.actionItems.length ? (
          <ul className="mt-3 space-y-3">
            {content.actionItems.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="font-medium">{item.task}</p>
                <p className="mt-2 text-sm text-slate-400">
                  Owner: {item.owner} · Deadline: {item.deadline} · Priority: {item.priority ?? "Not stated"}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-slate-400">No action items recorded.</p>}
      </section>
    </main>
  );
}
