"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type WorkspaceOption = { id: string; name: string };

export function WorkspaceManager({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>, action: "create" | "invite") => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(
        action === "create" ? "/api/workspaces" : `/api/workspaces/${workspaceId}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "create" ? { name } : { email, role: "member" }),
        },
      );
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "The request could not be completed.");
      setMessage(action === "create" ? "Workspace created." : "Invitation sent.");
      if (action === "create") setName("");
      else setEmail("");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 md:grid-cols-2">
      <form onSubmit={(event) => void submit(event, "create")} className="space-y-3">
        <h2 className="font-semibold text-white">Create a workspace</h2>
        <label className="sr-only" htmlFor="workspace-name">Workspace name</label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
          placeholder="Workspace name"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <button disabled={busy} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
          Create workspace
        </button>
      </form>

      <form onSubmit={(event) => void submit(event, "invite")} className="space-y-3">
        <h2 className="font-semibold text-white">Invite a member</h2>
        <label className="sr-only" htmlFor="invite-workspace">Workspace to invite to</label>
        <select
          id="invite-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          disabled={workspaces.length === 0 || busy}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="invite-email">Invitee email</label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          required
          placeholder="name@example.com"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <button disabled={busy || workspaces.length === 0} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Send invitation
        </button>
      </form>
      {message ? <p role="status" className="text-sm text-emerald-300 md:col-span-2">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300 md:col-span-2">{error}</p> : null}
    </section>
  );
}
