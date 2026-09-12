"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function RetestButton({ repositoryId, auditId }: { repositoryId: string; auditId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "queueing" | "error">("idle");

  async function retest() {
    setState("queueing");
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, auditMode: "deep", retestOfAuditId: auditId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Retest could not be queued");
      router.push(`/dashboard/audits/${data.audit.id}`);
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div>
      <Button onClick={retest} disabled={state === "queueing"}>
        {state === "queueing" ? "Queueing retest…" : "Retest returned work"}
      </Button>
      {state === "error" ? <p role="alert" className="mt-2 text-sm text-red-400">Retest could not be queued. Try again.</p> : null}
    </div>
  );
}
