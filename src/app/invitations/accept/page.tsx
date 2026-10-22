"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PENDING_INVITATION_KEY = "minutemate-pending-invitation";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Checking your invitation...");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    let active = true;
    const fragmentToken = window.location.hash.slice(1);
    const token = fragmentToken || window.sessionStorage.getItem(PENDING_INVITATION_KEY);
    if (fragmentToken) {
      window.sessionStorage.setItem(PENDING_INVITATION_KEY, fragmentToken);
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
      window.sessionStorage.removeItem(PENDING_INVITATION_KEY);
      void Promise.resolve().then(() => {
        if (active) setMessage("This invitation link is invalid or has expired.");
      });
      return () => {
        active = false;
      };
    }

    void fetch("/api/workspaces/accept-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        if (active) {
          setNeedsSignIn(true);
          setMessage("Sign in with the invited email address to accept this invitation.");
        }
        return;
      }
      if (!response.ok) throw new Error(data?.error ?? "Invitation could not be accepted.");
      window.sessionStorage.removeItem(PENDING_INVITATION_KEY);
      if (active) {
        setMessage("Invitation accepted. Opening your workspace...");
        router.replace("/");
        router.refresh();
      }
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Invitation could not be accepted.");
    });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-slate-50">
      <section className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
        <h1 className="text-2xl font-semibold">MinuteMate invitation</h1>
        <p role="status" className="text-sm text-slate-300">{message}</p>
        {needsSignIn ? (
          <Link href="/login?next=%2Finvitations%2Faccept" className="inline-flex rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950">
            Sign in to accept
          </Link>
        ) : null}
      </section>
    </main>
  );
}
