"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function UpgradeButton({ plan }: { plan: "pro" | "team" }) {
  const [loading, setLoading] = useState(false);

  async function checkout() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Checkout failed");
      }
      window.location.href = data.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={checkout} disabled={loading}>
      {loading ? "Redirecting…" : `Upgrade to ${plan}`}
    </Button>
  );
}
