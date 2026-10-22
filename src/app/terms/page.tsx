import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-5 py-12 text-slate-100">
      <Link href="/" className="text-sm text-sky-300 hover:text-sky-200">Back to MinuteMate</Link>
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Legal</p>
        <h1 className="text-3xl font-semibold">Terms of service</h1>
        <p className="text-sm text-slate-400">Last updated: October 23, 2026</p>
      </header>
      <section className="space-y-4 text-sm leading-7 text-slate-300">
        <p>
          These draft terms describe the intended use of MinuteMate and are not a substitute for jurisdiction-specific
          legal advice. The service operator must review and complete these terms before accepting customers.
        </p>
        <h2 className="text-xl font-semibold text-white">Your account and content</h2>
        <p>
          Keep your account credentials secure and use the service only for content you are authorized to process.
          You retain responsibility for meeting recordings, participant notices and consent, and the accuracy and
          appropriate use of generated transcripts, minutes, and action items.
        </p>
        <h2 className="text-xl font-semibold text-white">AI-generated results</h2>
        <p>
          Transcription and generated meeting content may be incomplete or incorrect. Review all output before relying
          on it or sharing it. MinuteMate is not a legal, medical, financial, or employment decision service.
        </p>
        <h2 className="text-xl font-semibold text-white">Acceptable use and billing</h2>
        <p>
          Do not use MinuteMate unlawfully, to infringe others&apos; rights, or to interfere with service security.
          Paid plans, limits, billing intervals, cancellation, refunds, and taxes must be clearly presented during
          checkout and completed by the service operator before launch.
        </p>
        <h2 className="text-xl font-semibold text-white">Availability and termination</h2>
        <p>
          The service is provided subject to the service operator&apos;s final availability, warranty, liability,
          dispute-resolution, and termination terms. You may delete your account using <Link className="text-sky-300 underline" href="/settings/privacy">Data controls</Link>.
        </p>
      </section>
    </main>
  );
}
