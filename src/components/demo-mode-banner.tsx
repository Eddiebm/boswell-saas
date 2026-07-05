import { isDemoMode } from "@/lib/demo/mode";

export function DemoModeBanner() {
  if (!isDemoMode()) return null;

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/15 px-6 py-2 text-center text-sm text-amber-100">
      <strong>Demo mode</strong> — you are viewing seeded sample data, not your GitHub repositories.
      Set live env vars and disable <code className="rounded bg-black/30 px-1">BOSWELL_DEMO</code> to use
      real audits.
    </div>
  );
}
