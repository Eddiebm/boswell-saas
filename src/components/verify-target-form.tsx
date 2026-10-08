"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/ui";
import type { LoginCandidate, ResourceCandidate } from "@/lib/dynamic-verify/discover";

const FIELDS = [
  { name: "label", label: "Label", placeholder: "Order access control" },
  { name: "stagingUrl", label: "Staging URL", placeholder: "https://staging.myapp.dev" },
  { name: "loginPath", label: "Login path", placeholder: "/api/login" },
  { name: "accountAEmail", label: "Account A email", placeholder: "test-a@myapp.dev" },
  { name: "accountAPassword", label: "Account A password", placeholder: "••••••••", type: "password" },
  { name: "accountBEmail", label: "Account B email", placeholder: "test-b@myapp.dev" },
  { name: "accountBPassword", label: "Account B password", placeholder: "••••••••", type: "password" },
  { name: "resourcePathTemplate", label: "Resource path template", placeholder: "/api/orders/{id}" },
  { name: "accountAResourceId", label: "A resource id to test", placeholder: "order-123" },
] as const;

const CONFIDENCE_TONE = { high: "bad", medium: "warn", low: "neutral" } as const;

export function VerifyTargetForm({
  repositoryId,
  loginCandidates = [],
  resourceCandidates = [],
}: {
  repositoryId: string;
  loginCandidates?: LoginCandidate[];
  resourceCandidates?: ResourceCandidate[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applySuggestion(field: string, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/verify/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryId, consentConfirmed, ...values }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Failed to create target");
      return;
    }
    setValues({});
    setConsentConfirmed(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-zinc-400">
        Two accounts you already created on a <strong>staging or non-production</strong> instance.
        Boswell logs in as each and issues a single read-only request to prove — or rule out — a
        cross-account access-control leak. It never signs up new accounts and never writes to your
        app.
      </p>

      {loginCandidates.length > 0 || resourceCandidates.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Discovered from your repo — click to fill in below, or type your own
          </p>
          {loginCandidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Login endpoint:</span>
              {loginCandidates.slice(0, 5).map((c) => (
                <button
                  key={c.loginPath}
                  type="button"
                  title={c.reason}
                  onClick={() => applySuggestion("loginPath", c.loginPath)}
                  className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  {c.loginPath} <Badge tone={CONFIDENCE_TONE[c.confidence]}>{c.confidence}</Badge>
                </button>
              ))}
            </div>
          ) : null}
          {resourceCandidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Resource route:</span>
              {resourceCandidates.slice(0, 8).map((c) => (
                <button
                  key={c.resourcePathTemplate + c.filePath}
                  type="button"
                  title={`${c.reason} (${c.filePath})`}
                  onClick={() => applySuggestion("resourcePathTemplate", c.resourcePathTemplate)}
                  className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  {c.resourcePathTemplate} <Badge tone={CONFIDENCE_TONE[c.confidence]}>{c.confidence}</Badge>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          No route candidates discovered yet — they appear here after the repo&apos;s next audit
          completes.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.name} className="space-y-1 text-sm text-zinc-300">
            <span>{field.label}</span>
            <Input
              required
              type={"type" in field ? field.type : "text"}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label className="flex items-start gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentConfirmed}
          onChange={(e) => setConsentConfirmed(e.target.checked)}
        />
        <span>
          I confirm this is a staging or non-production environment that I own or am authorized to
          test, and that these are throwaway test accounts, not real users.
        </span>
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <Button type="submit" disabled={submitting || !consentConfirmed}>
        {submitting ? "Saving…" : "Add verification target"}
      </Button>
    </form>
  );
}
