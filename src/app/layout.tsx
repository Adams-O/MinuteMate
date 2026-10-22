import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MinuteMate",
  description: "AI meeting recorder that transcribes meetings and writes minutes and action items automatically.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-950 text-slate-50">
        {children}
        <footer className="border-t border-slate-800 px-5 py-6 text-sm text-slate-400">
          <nav aria-label="Legal and privacy" className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-slate-200">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-200">Terms</Link>
            <Link href="/cookies" className="hover:text-slate-200">Cookies</Link>
            <Link href="/settings/privacy" className="hover:text-slate-200">Data controls</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
