"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function SetPrimaryRepoButton({
  repositoryId,
  isPrimary,
}: {
  repositoryId: string;
  isPrimary: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setPrimary() {
    setLoading(true);
    try {
      const res = await fetch("/api/repos/primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (isPrimary) {
    return <span className="text-center text-xs text-emerald-300">Dashboard default</span>;
  }

  return (
    <Button onClick={() => void setPrimary()} disabled={loading} variant="ghost">
      {loading ? "Setting…" : "Set as dashboard default"}
    </Button>
  );
}
