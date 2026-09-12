"use client";

import { useState } from "react";
import { BUILDER_IDS, BUILDER_LABELS, type BuilderId } from "@/lib/reports/fix-prompt";
import { Button } from "@/components/ui";

export function BuilderRepairBrief({ prompts }: { prompts: Record<BuilderId, string> }) {
  const [builder, setBuilder] = useState<BuilderId>("universal");
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const prompt = prompts[builder];

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  function downloadPrompt() {
    const blob = new Blob([prompt], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `boswell-repair-brief-${builder}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-zinc-300">
          Send the repair brief to
          <select
            className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-white"
            value={builder}
            onChange={(event) => {
              setBuilder(event.target.value as BuilderId);
              setStatus("idle");
            }}
          >
            {BUILDER_IDS.map((id) => <option key={id} value={id}>{BUILDER_LABELS[id]}</option>)}
          </select>
        </label>
        <Button onClick={copyPrompt}>{status === "copied" ? "Copied" : "Copy repair brief"}</Button>
        <Button onClick={downloadPrompt}>Download brief</Button>
      </div>
      {status === "error" ? <p role="alert" className="text-sm text-red-400">Could not copy. Download the brief instead.</p> : null}
      <p className="text-sm text-zinc-400">
        The builder proposes changes on a branch or checkpoint. Boswell—not the builder—must retest the returned revision.
      </p>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-emerald-500/20 bg-zinc-950 p-4 text-sm text-zinc-200">
        {prompt}
      </pre>
    </div>
  );
}
