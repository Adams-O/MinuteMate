import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-5 py-12 text-slate-100">
      <Link href="/" className="text-sm text-sky-300 hover:text-sky-200">Back to MinuteMate</Link>
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Legal</p>
        <h1 className="text-3xl font-semibold">Privacy notice</h1>
        <p className="text-sm text-slate-400">Last updated: October 23, 2026</p>
      </header>
      <section className="space-y-4 text-sm leading-7 text-slate-300">
        <h2 className="text-xl font-semibold text-white">Information MinuteMate processes</h2>
        <p>
          MinuteMate processes account and workspace information, meeting audio you record or upload, transcripts,
          minutes, action items, and service activity needed to operate the product. Do not upload information unless
          you have authority to do so.
        </p>
        <h2 className="text-xl font-semibold text-white">Meeting recording and AI providers</h2>
        <p>
          You must obtain informed consent from every participant before recording. Audio is sent to AssemblyAI for
          transcription. Transcript content is sent to Anthropic to generate minutes and action items. These providers
          process data to provide the requested service; configure and review their terms, retention, and region
          settings before enabling production use.
        </p>
        <p>
          Meeting files are stored in a private Supabase Storage bucket. By default, source audio is deleted after
          successful transcription; a meeting can be configured to retain it. Retained audio is available only through
          short-lived signed URLs. Deleting a meeting or account removes stored audio and related application records,
          subject to provider and backup retention.
        </p>
        <h2 className="text-xl font-semibold text-white">Other service providers</h2>
        <p>
          Supabase provides authentication, database, and storage; Resend delivers emails you request; Paystack
          processes paid subscriptions; Upstash applies rate limits; Sentry receives error telemetry with personal
          content and request details scrubbed; and Vercel hosts the application. Payment and email providers receive
          only information needed for their respective services.
        </p>
        <h2 className="text-xl font-semibold text-white">Analytics and security</h2>
        <p>
          MinuteMate records aggregate daily counts of meeting creation and completion. These counters do not contain
          account IDs, meeting IDs, transcript text, or action-item content. Rate-limit keys contain a one-way hash of
          the requesting account identifier. We do not intentionally log audio, transcripts, minutes, action items,
          signed URLs, or authentication tokens.
        </p>
        <h2 className="text-xl font-semibold text-white">Your controls</h2>
        <p>
          You can export your account data or request permanent account deletion from <Link className="text-sky-300 underline" href="/settings/privacy">Data controls</Link>.
          You can also delete individual meetings and choose whether their source audio is retained. An account deletion
          transfers workspace ownership to another member where possible; workspaces with no remaining members are
          removed.
        </p>
        <h2 className="text-xl font-semibold text-white">Retention and contact</h2>
        <p>
          Application records are retained until you delete them or the account, unless a limited retention period is
          required for security, billing, or legal obligations. Configure support and privacy contact details before
          launch; this page is a product notice template and requires review for your operating jurisdiction.
        </p>
      </section>
    </main>
  );
}
