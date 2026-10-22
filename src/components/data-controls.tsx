"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DataControls() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<"export" | "delete" | null>(null);
  const [message, setMessage] = useState("");

  async function exportData() {
    setPending("export");
    setMessage("");
    try {
      const response = await fetch("/api/account/export", { cache: "no-store" });
      if (!response.ok) {
        setMessage("Your export could not be prepared. Please try again later.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "minutemate-data.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Your data export has been downloaded.");
    } catch {
      setMessage("Your export could not be prepared. Please check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setPending("delete");
    setMessage("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!response.ok) {
        setMessage("Your account could not be deleted. Please try again or contact support.");
        return;
      }
      setMessage("Your account and MinuteMate data have been deleted. Redirecting to sign in...");
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch {
      setMessage("Your account could not be deleted. Please check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h2 className="text-xl font-semibold">Export your data</h2>
        <p className="text-sm leading-6 text-slate-300">
          Download your profile, workspaces, meetings, transcripts, minutes, and action items. Retained audio is
          provided through links that expire after five minutes.
        </p>
        <button
          type="button"
          onClick={exportData}
          disabled={pending !== null}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-sky-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {pending === "export" ? "Preparing export..." : "Download my data"}
        </button>
      </section>
      <section className="space-y-3 rounded-2xl border border-rose-900/70 bg-rose-950/20 p-6">
        <h2 className="text-xl font-semibold">Delete your account</h2>
        <p className="text-sm leading-6 text-slate-300">
          This permanently removes your account, meeting content, and stored audio. Workspace ownership is transferred
          to another member where possible. Data already retained by external providers or in backups may follow their
          own retention policies. This cannot be undone.
        </p>
        <form onSubmit={deleteAccount} className="space-y-3">
          <label htmlFor="delete-confirmation" className="block text-sm font-medium text-slate-200">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 sm:max-w-xs"
          />
          <button
            type="submit"
            disabled={pending !== null || confirmation !== "DELETE"}
            className="block rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {pending === "delete" ? "Deleting account..." : "Permanently delete account"}
          </button>
        </form>
      </section>
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-slate-300">{message}</p>
    </div>
  );
}
