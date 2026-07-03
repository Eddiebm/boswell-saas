"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyFixPromptButton({ prompt }: { prompt: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

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
    anchor.download = "boswell-fix-prompt.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={copyPrompt}>{status === "copied" ? "Copied" : "Copy fix prompt"}</Button>
      <Button onClick={downloadPrompt}>Download prompt</Button>
      {status === "error" ? (
        <p className="text-sm text-red-400">Could not copy. Use download instead.</p>
      ) : null}
    </div>
  );
}
