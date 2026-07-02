"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AuditPoller({ status }: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [status, router]);

  return null;
}
