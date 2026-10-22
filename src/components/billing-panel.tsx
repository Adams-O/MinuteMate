"use client";

import { useEffect, useState } from "react";

type WorkspaceOption = { id: string; name: string };
type BillingData = {
  isEntitled: boolean;
  price: { display: string } | null;
  subscription: {
    plan: "free" | "pro";
    status: "active" | "pending" | "cancelled" | "past_due";
    currency: string | null;
    amount_minor: number | null;
    current_period_start: string | null;
    current_period_end: string | null;
  };
  usage: {
    meetings: number;
    audioSeconds: number;
    meetingLimit: number;
    audioSecondsLimit: number;
  };
};

export function BillingPanel({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = !!workspaceId && loadedWorkspaceId !== workspaceId;

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void fetch(`/api/billing?workspaceId=${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => null) as BillingData | { error?: string } | null;
      if (!response.ok || !data || !("subscription" in data)) {
        throw new Error(data && "error" in data ? data.error : "Billing data could not be loaded.");
      }
      setBilling(data);
      setError(null);
      setLoadedWorkspaceId(workspaceId);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        setBilling(null);
        setError(requestError instanceof Error ? requestError.message : "Billing data could not be loaded.");
        setLoadedWorkspaceId(workspaceId);
      }
    });
    return () => controller.abort();
  }, [workspaceId]);

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await response.json().catch(() => null) as { authorizationUrl?: string; error?: string } | null;
      if (!response.ok || !data?.authorizationUrl) throw new Error(data?.error ?? "Checkout could not be started.");
      window.location.assign(data.authorizationUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout could not be started.");
      setBusy(false);
    }
  };

  if (workspaces.length === 0) return <p>No workspace is available for billing.</p>;
  const currentBilling = loadedWorkspaceId === workspaceId ? billing : null;
  return (
    <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <label className="block space-y-2 text-sm">
        <span>Workspace</span>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </label>
      {loading ? <p role="status">Loading plan and usage…</p> : null}
      {currentBilling ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Current plan</p>
              <p className="mt-1 text-xl font-semibold capitalize">{currentBilling.subscription.plan}</p>
            </div>
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs capitalize">{currentBilling.subscription.status}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="rounded-xl border border-slate-800 p-4">
              Meetings this month: <strong>{currentBilling.usage.meetings}/{currentBilling.usage.meetingLimit}</strong>
            </p>
            <p className="rounded-xl border border-slate-800 p-4">
              Audio minutes this month: <strong>{Math.ceil(currentBilling.usage.audioSeconds / 60)}/{currentBilling.usage.audioSecondsLimit / 60}</strong>
            </p>
          </div>
          {!currentBilling.isEntitled && currentBilling.price ? (
            <p className="text-sm text-slate-300">
              Monthly plan: {currentBilling.price.display}
            </p>
          ) : null}
          {currentBilling.subscription.current_period_end ? (
            <p className="text-sm text-slate-400">Current paid period ends {new Date(currentBilling.subscription.current_period_end).toLocaleDateString()}.</p>
          ) : null}
          {!currentBilling.isEntitled ? (
            <button type="button" onClick={() => void startCheckout()} disabled={busy} className="rounded-lg bg-sky-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">
              {busy ? "Opening secure checkout…" : "Upgrade with Paystack"}
            </button>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </section>
  );
}
