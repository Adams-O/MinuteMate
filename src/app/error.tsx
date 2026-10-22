"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-slate-50">
      <section className="max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm leading-6 text-slate-300">
          We could not load this page. Your saved meeting data has not been intentionally changed.
        </p>
        {error.digest ? <p className="text-xs text-slate-500">Reference: {error.digest}</p> : null}
        <button onClick={() => reset()} className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950">
          Try again
        </button>
      </section>
    </main>
  );
}
