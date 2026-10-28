import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_UPDATED = "October 28, 2026";

export function contactLine() {
  const email = process.env.SUPPORT_EMAIL;
  return email ? (
    <a href={`mailto:${email}`} className="underline">
      {email}
    </a>
  ) : (
    "replying to any email Boswell has sent you"
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link href="/" className="text-sm text-zinc-500 underline">
        ← Boswell
      </Link>
      <h1 className="mt-6 text-3xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-white [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </main>
  );
}
