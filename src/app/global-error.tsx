"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50">
        <main className="flex min-h-screen items-center justify-center px-5">
          <section className="max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
            <h1 className="text-2xl font-semibold">MinuteMate is temporarily unavailable</h1>
            <p className="text-sm leading-6 text-slate-300">Please try again. If the problem continues, contact support.</p>
            <button onClick={() => reset()} className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950">
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
