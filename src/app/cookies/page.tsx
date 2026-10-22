import Link from "next/link";

export default function CookiesPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-5 py-12 text-slate-100">
      <Link href="/" className="text-sm text-sky-300 hover:text-sky-200">Back to MinuteMate</Link>
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Legal</p>
        <h1 className="text-3xl font-semibold">Cookie notice</h1>
        <p className="text-sm text-slate-400">Last updated: October 23, 2026</p>
      </header>
      <section className="space-y-4 text-sm leading-7 text-slate-300">
        <p>
          MinuteMate uses essential Supabase authentication cookies to keep you signed in and protect authenticated
          requests. These cookies support core service functionality. Do not add advertising, cross-site tracking, or
          non-essential analytics cookies without updating this notice and implementing any required consent controls.
        </p>
        <p>
          Product analytics currently stores aggregate daily meeting counts server-side and does not set analytics
          cookies. Your browser may also keep temporary interface state in session storage while you use a page.
        </p>
        <p>
          The service operator should confirm cookie names, lifetimes, jurisdictional requirements, and current provider
          behavior before production launch. See the <Link className="text-sky-300 underline" href="/privacy">Privacy notice</Link>.
        </p>
      </section>
    </main>
  );
}
