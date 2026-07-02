import { Badge } from "@/components/ui";

export function AuditStatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "good"
      : status === "failed"
        ? "bad"
        : status === "running"
          ? "warn"
          : "neutral";

  return <Badge tone={tone}>{status}</Badge>;
}
