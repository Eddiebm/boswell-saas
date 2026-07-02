export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { BrainChat } from "@/components/brain-chat";

export default function BrainPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Engineering brain</h1>
        <p className="mt-2 text-zinc-400">
          Ask questions grounded in audits, files, scores, and memory. Boswell will not invent facts.
        </p>
      </div>
      <Card>
        <BrainChat />
      </Card>
    </div>
  );
}
