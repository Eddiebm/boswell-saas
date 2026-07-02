"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

type BrainResponse = {
  answer: string;
  evidence: string[];
};

export function BrainChat() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<BrainResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const presets = [
    "Where is authentication handled?",
    "Why is this repo risky?",
    "What files should I review first?",
    "What changed since the last audit?",
    "What is the biggest technical debt?",
    "What would you fix today?",
    "Which files look AI-generated?",
    "What is safe to auto-fix?",
    "What is dangerous?",
  ];

  async function ask(q: string) {
    setLoading(true);
    setQuestion(q);
    const res = await fetch("/api/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    const data = (await res.json()) as BrainResponse;
    setResponse(data);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => ask(p)}
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
          >
            {p}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) void ask(question.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Boswell about this repository…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Thinking…" : "Ask"}
        </Button>
      </form>
      {response ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm leading-7 text-zinc-300">{response.answer}</p>
          {response.evidence?.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Evidence</p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                {response.evidence.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
