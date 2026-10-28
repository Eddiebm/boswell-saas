import { classifyFinding, type ShipFinding } from "@/lib/ship-ready/checklist";

export type GuardFinding = ShipFinding;

export type GuardOutcome = {
  state: "success" | "failure";
  /** ≤ 140 chars, for the GitHub commit status. */
  description: string;
  newBlockers: GuardFinding[];
  newReview: GuardFinding[];
  resolved: GuardFinding[];
  existingBlockers: number;
};

/**
 * Identity of a finding across runs. Counts in titles ("9 routes…") change as
 * code changes without it being a new problem, so digits are ignored.
 */
function key(f: GuardFinding) {
  return `${f.ruleId ?? f.category}|${f.filePath ?? ""}|${f.title.replace(/\d+/g, "#")}`;
}

/**
 * The guard judges changes, not the whole app: a push or PR fails only when
 * it introduces a new launch blocker. Problems that were already there are
 * reported, but don't turn every PR red.
 */
export function compareGuard(baseline: GuardFinding[] | null, current: GuardFinding[]): GuardOutcome {
  const before = new Set((baseline ?? []).map(key));
  const now = new Set(current.map(key));
  const level = (f: GuardFinding) => classifyFinding(f)?.level ?? null;

  const isNew = (f: GuardFinding) => baseline !== null && !before.has(key(f));
  const newBlockers = current.filter((f) => level(f) === "block" && isNew(f));
  const newReview = current.filter((f) => level(f) === "review" && isNew(f));
  const existingBlockers = current.filter((f) => level(f) === "block" && !isNew(f)).length;
  const resolved = (baseline ?? []).filter((f) => level(f) !== null && !now.has(key(f)));

  const state = newBlockers.length ? "failure" : "success";
  const parts = [
    newBlockers.length ? `${newBlockers.length} new launch ${newBlockers.length === 1 ? "blocker" : "blockers"}` : "No new launch blockers",
    newReview.length ? `${newReview.length} to check` : "",
    resolved.length ? `${resolved.length} fixed` : "",
    baseline === null ? "first check — baseline set" : "",
  ].filter(Boolean);
  return { state, description: parts.join(" · ").slice(0, 140), newBlockers, newReview, resolved, existingBlockers };
}

function row(f: GuardFinding) {
  const where = f.filePath ? `\`${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}\`` : "";
  return `| ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${where} |`;
}

export const GUARD_MARKER = "<!-- boswell-guard -->";

export function guardComment(outcome: GuardOutcome, shipReadyUrl: string): string {
  const lines = [GUARD_MARKER, "### Boswell Ship Ready guard", ""];
  if (outcome.newBlockers.length) {
    lines.push(
      `❌ **This change adds ${outcome.newBlockers.length} launch ${outcome.newBlockers.length === 1 ? "blocker" : "blockers"}.**`,
      "",
      "| Severity | Finding | Where |",
      "| --- | --- | --- |",
      ...outcome.newBlockers.slice(0, 10).map(row),
      "",
      ...outcome.newBlockers.slice(0, 3).flatMap((f) => (f.recommendation ? [`- **${f.title}:** ${f.recommendation}`] : [])),
    );
  } else {
    lines.push("✅ **No new launch blockers in this change.**");
  }
  if (outcome.newReview.length) {
    lines.push("", `**Worth a look (${outcome.newReview.length})** — pattern matches, not proof:`, "", "| Severity | Finding | Where |", "| --- | --- | --- |", ...outcome.newReview.slice(0, 10).map(row));
  }
  if (outcome.resolved.length) {
    lines.push("", `🎉 **Fixed by this change:** ${outcome.resolved.slice(0, 8).map((f) => f.title).join("; ")}`);
  }
  if (outcome.existingBlockers) {
    lines.push("", `${outcome.existingBlockers} launch ${outcome.existingBlockers === 1 ? "blocker was" : "blockers were"} already on the base branch — not counted against this change.`);
  }
  lines.push("", `[Open Ship Ready](${shipReadyUrl}) · checks only, no code was run`);
  return lines.join("\n");
}
