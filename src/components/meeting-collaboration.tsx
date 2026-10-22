"use client";

import { FormEvent, useEffect, useState } from "react";
import { z } from "zod";

const ShareRecordSchema = z.object({
  id: z.string().uuid(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
const ShareResponseSchema = z.object({
  share: ShareRecordSchema.extend({ url: z.string().url() }),
});
const ShareListSchema = z.object({ shares: z.array(ShareRecordSchema) });

type ShareRecord = z.infer<typeof ShareRecordSchema>;

export function MeetingCollaboration({ meetingId }: { meetingId: string }) {
  const [recipients, setRecipients] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState("168");
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/meetings/${meetingId}/share`)
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("Share links could not be loaded.");
        const parsed = ShareListSchema.safeParse(body);
        if (!parsed.success) throw new Error("Share links could not be loaded.");
        if (active) setShares(parsed.data.shares);
      })
      .catch(() => {
        if (active) setShareMessage("Share links could not be loaded. Refresh the page to retry.");
      });
    return () => { active = false; };
  }, [meetingId]);

  const emailMinutes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailBusy(true);
    setEmailMessage(null);
    const normalizedRecipients = recipients.split(/[\n,;]/).map((address) => address.trim()).filter(Boolean);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: normalizedRecipients, confirmed }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        setEmailMessage(parsed.success ? parsed.data.error : "Minutes could not be emailed.");
        return;
      }
      setEmailMessage(`Minutes sent to ${normalizedRecipients.length} recipient${normalizedRecipients.length === 1 ? "" : "s"}.`);
      setRecipients("");
      setConfirmed(false);
    } catch {
      setEmailMessage("Minutes could not be emailed. Please retry.");
    } finally {
      setEmailBusy(false);
    }
  };

  const createShare = async () => {
    setShareBusy(true);
    setShareMessage(null);
    setNewUrl(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInHours: Number(expiryHours) }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        setShareMessage(parsed.success ? parsed.data.error : "Share link could not be created.");
        return;
      }
      const parsed = ShareResponseSchema.safeParse(body);
      if (!parsed.success) {
        setShareMessage("Share link response was invalid.");
        return;
      }
      setNewUrl(parsed.data.share.url);
      setShares((current) => [parsed.data.share, ...current]);
    } catch {
      setShareMessage("Share link could not be created. Please retry.");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    setShareBusy(true);
    setShareMessage(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        setShareMessage(parsed.success ? parsed.data.error : "Share link could not be revoked.");
        return;
      }
      setShares((current) => current.map((share) => (
        share.id === shareId ? { ...share, revoked_at: new Date().toISOString() } : share
      )));
      setNewUrl(null);
      setShareMessage("Share link revoked.");
    } catch {
      setShareMessage("Share link could not be revoked. Please retry.");
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <h2 className="font-semibold text-white">Export minutes</h2>
          <p className="mt-1 text-sm text-slate-400">Download the summary, decisions, and action items.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/meetings/${meetingId}/export?format=pdf`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-sky-200 hover:bg-slate-800">Download PDF</a>
          <a href={`/api/meetings/${meetingId}/export?format=docx`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-sky-200 hover:bg-slate-800">Download Word</a>
        </div>
        <form onSubmit={emailMinutes} className="space-y-3 border-t border-slate-800 pt-4">
          <h3 className="font-medium text-white">Email attendees</h3>
          <label className="block text-sm text-slate-300" htmlFor="meeting-recipients">
            Email addresses (one per line or separated by commas)
          </label>
          <textarea
            id="meeting-recipients"
            value={recipients}
            onChange={(event) => setRecipients(event.target.value)}
            maxLength={6000}
            required
            rows={3}
            placeholder="attendee@example.com"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white"
          />
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required className="mt-1" />
            <span>I confirm these recipients should receive this meeting’s minutes.</span>
          </label>
          <button type="submit" disabled={emailBusy || !confirmed} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
            {emailBusy ? "Sending..." : "Send minutes"}
          </button>
          {emailMessage ? <p role="status" className="text-sm text-slate-300">{emailMessage}</p> : null}
        </form>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <h2 className="font-semibold text-white">Secure share links</h2>
          <p className="mt-1 text-sm text-slate-400">Recipients can view minutes and action items only, never the transcript or audio.</p>
        </div>
        <label className="block text-sm text-slate-300">
          Link expires after
          <select value={expiryHours} onChange={(event) => setExpiryHours(event.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </label>
        <button type="button" onClick={createShare} disabled={shareBusy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
          {shareBusy ? "Working..." : "Create share link"}
        </button>
        {newUrl ? (
          <p className="break-all rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-200">
            Copy this link now: <a href={newUrl} className="underline">{newUrl}</a>
          </p>
        ) : null}
        {shares.map((share) => (
          <div key={share.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-sm">
            <p className="text-slate-300">
              {share.revoked_at ? "Revoked" : new Date(share.expires_at) <= new Date() ? "Expired" : "Active"} · expires {new Date(share.expires_at).toLocaleString()}
            </p>
            {!share.revoked_at && new Date(share.expires_at) > new Date() ? (
              <button type="button" onClick={() => void revokeShare(share.id)} disabled={shareBusy} className="text-rose-300 underline disabled:opacity-50">Revoke</button>
            ) : null}
          </div>
        ))}
        {shareMessage ? <p role="status" className="text-sm text-slate-300">{shareMessage}</p> : null}
      </div>
    </section>
  );
}
