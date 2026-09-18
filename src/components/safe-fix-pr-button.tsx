"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { authorizeGithubRepoScope } from "@/lib/auth/step-up";

export function SafeFixPrButton({ itemId }: { itemId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRepoScope, setNeedsRepoScope] = useState(false);

  async function createPr() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        prUrl?: string;
        error?: string;
        needsRepoScope?: boolean;
      };
      if (!res.ok) {
        if (data.needsRepoScope) {
          setNeedsRepoScope(true);
        }
        throw new Error(data.error ?? "Failed to create PR");
      }
      setMessage(data.message ?? "PR opened");
      if (data.prUrl) setPrUrl(data.prUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {needsRepoScope ? (
        // Requests the broader `repo` GitHub scope via a Server Action, only
        // at the moment a Pro+ user actually tries to use PR automation (see
        // src/lib/auth/step-up.ts). `redirect()` inside that action navigates
        // the browser through GitHub's consent screen and back — plain <form
        // action> keeps that redirect outside any client-side try/catch,
        // matching the sign-in pattern used elsewhere in this app.
        <form action={authorizeGithubRepoScope.bind(null, "/dashboard/fix-queue")}>
          <Button type="submit" variant="secondary">
            Authorize GitHub for PR automation
          </Button>
        </form>
      ) : (
        <Button onClick={createPr} disabled={loading} variant="secondary">
          {loading ? "Opening PR…" : "Create safe-fix PR"}
        </Button>
      )}
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {prUrl ? (
        <a href={prUrl} target="_blank" rel="noreferrer" className="text-sm underline">
          View pull request
        </a>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
