export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { BrainChat } from "@/components/brain-chat";
import { getMemory, DEMO_REPO_ID } from "@/lib/data";

const memoryPrompts = [
  "What keeps getting worse?",
  "What did we fix?",
  "What have we ignored?",
  "What changed since last month?",
  "Why is this repo riskier now?",
];

export default async function MemoryPage() {
  const events = await getMemory(DEMO_REPO_ID);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Engineering memory</h1>
        <p className="mt-2 text-zinc-400">
          Boswell remembers audits, fixes, regressions, and recurring problem areas.
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-medium">Ask memory</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {memoryPrompts.map((p) => (
            <span key={p} className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
              {p}
            </span>
          ))}
        </div>
        <BrainChat />
      </Card>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Timeline</h2>
        {events.map((event) => (
          <Card key={event.id}>
            <p className="text-xs text-zinc-500">{String(event.occurredAt)}</p>
            <p className="mt-1 font-medium">{event.title}</p>
            <p className="mt-1 text-sm text-zinc-400">{event.summary}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
