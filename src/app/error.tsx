"use client";

import { Button } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
        <h1 className="text-xl font-semibold">Boswell hit an unexpected problem</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Your request was not completed. Try again, or contact support with reference
          {` ${error.digest ?? "unavailable"}`}.
        </p>
        <div className="mt-5">
          <Button onClick={reset} variant="secondary">Try again</Button>
        </div>
      </section>
    </main>
  );
}
