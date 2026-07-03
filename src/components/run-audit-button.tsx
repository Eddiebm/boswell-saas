"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUDIT_MODES,
  auditModeDescription,
  auditModeLabel,
  type AuditMode,
} from "@/lib/audit-modes";
import { Button } from "@/components/ui";

export function RunAuditButton({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditMode, setAuditMode] = useState<AuditMode>("standard");

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, auditMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to queue audit");
      }
      router.push(`/dashboard/audits/${data.audit.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue audit");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor={`audit-mode-${repositoryId}`} className="text-sm text-zinc-400">
          Audit mode
        </label>
        <select
          id={`audit-mode-${repositoryId}`}
          value={auditMode}
          onChange={(event) => setAuditMode(event.target.value as AuditMode)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          disabled={loading}
        >
          {AUDIT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {auditModeLabel(mode)}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">{auditModeDescription(auditMode)}</p>
      </div>
      <Button onClick={runAudit} disabled={loading}>
        {loading ? "Queueing…" : "Run audit"}
      </Button>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
