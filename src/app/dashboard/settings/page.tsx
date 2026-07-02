export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { isDemoMode } from "@/lib/demo/mode";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <Card className="space-y-3 text-sm text-zinc-300">
        <p>
          <strong>Demo mode:</strong> {isDemoMode() ? "On" : "Off"}
        </p>
        <p>
          <strong>GitHub:</strong> Connect via sign-in to sync repositories.
        </p>
        <p>
          <strong>Worker:</strong> Long audits run via <code>npm run worker</code> or Render — never inside web requests.
        </p>
        <p>
          <strong>PR mode:</strong> Boswell creates branches and PRs only. Never pushes to main.
        </p>
      </Card>
    </div>
  );
}
