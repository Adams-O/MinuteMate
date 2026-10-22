"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const AuthInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function getSafeNextPath(): string {
    return new URLSearchParams(window.location.search).get("next") === "/invitations/accept"
      ? "/invitations/accept"
      : "/";
  }

  function getAuthCallbackUrl(): string {
    const callback = new URL("/auth/callback", window.location.origin);
    const nextPath = getSafeNextPath();
    if (nextPath !== "/") callback.searchParams.set("next", nextPath);
    return callback.toString();
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = AuthInputSchema.safeParse({ email: email.trim(), password });
    if (!input.success) {
      setError("Enter a valid email and a password between 8 and 128 characters.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "sign-up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: input.data.email,
          password: input.data.password,
          options: { emailRedirectTo: getAuthCallbackUrl() },
        });
        if (signUpError) throw signUpError;
        setMessage("Check your email for a link to confirm your account.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword(input.data);
        if (signInError) throw signInError;
        router.replace(getSafeNextPath());
        router.refresh();
      }
    } catch {
      setError("We could not complete sign-in. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: getAuthCallbackUrl() },
      });
      if (oauthError) throw oauthError;
    } catch {
      setError("Google sign-in is unavailable. Try email sign-in or try again later.");
      setBusy(false);
    }

  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-slate-50">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-xl">
        <Link href="/" className="text-sm font-semibold text-sky-300">MinuteMate</Link>
        <h1 className="mt-5 text-3xl font-semibold">
          {mode === "sign-in" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Sign in to manage private meeting recordings and minutes.
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-6 w-full rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-700" />
          <span>OR EMAIL</span>
          <span className="h-px flex-1 bg-slate-700" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-50 outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-50 outline-none focus:border-sky-400"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
          >
            {busy ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>

        {message ? <p role="status" className="mt-4 text-sm text-emerald-300">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}

        <p className="mt-6 text-center text-sm text-slate-400">
          {mode === "sign-in" ? "New to MinuteMate?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            className="font-medium text-sky-300 hover:text-sky-200"
          >
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}