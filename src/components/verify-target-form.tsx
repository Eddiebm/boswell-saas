"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";

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

export function VerifyTargetForm({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
