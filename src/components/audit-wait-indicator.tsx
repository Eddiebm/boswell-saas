"use client";

import { useEffect, useState } from "react";

function elapsedLabel(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function AuditWaitIndicator({
  status,
  createdAt,
  startedAt,
}: {
  status: string;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (status !== "queued" && status !== "running") return null;

  const anchor = status === "running" && startedAt ? startedAt : createdAt;
  if (!anchor) return null;

  const elapsedMs = now - new Date(anchor).getTime();
  const queuedTooLong = status === "queued" && elapsedMs >= 45 * 60 * 1000;

  return (
    <p className={`text-sm ${queuedTooLong ? "text-amber-300" : "text-zinc-400"}`}>
      {status === "queued" ? "Queued" : "Running"} for {elapsedLabel(elapsedMs)}
      {queuedTooLong
        ? " — cloud worker can take up to an hour on GitHub Actions. Hang tight."
        : null}
    </p>
  );
}
