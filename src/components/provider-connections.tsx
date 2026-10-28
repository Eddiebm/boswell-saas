"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";

type Provider = "supabase" | "vercel" | "neon";
type Connected = { provider: Provider; projectRef: string };

const INFO: Record<Provider, { name: string; reads: string; token: string; ref: string; refLabel: string }> = {
  supabase: {
    name: "Supabase",
    reads: "Project status, backups, and row level security on every live table (via Supabase's read-only SQL endpoint).",
    token: "Account → Access Tokens → Generate new token. Supabase tokens can't be limited to read-only; Boswell only reads, and stores the token encrypted.",
    ref: "The project ref in your dashboard URL (supabase.com/dashboard/project/<ref>).",
    refLabel: "Project ref",
  },
  vercel: {
    name: "Vercel",
    reads: "Which environment variables production has (names only, never values) and whether the latest production deploy succeeded.",
    token: "Account Settings → Tokens. Scope it to the team that owns the project and give it an expiry.",
    ref: "Project → Settings → General → Project ID (or the project name). Add the team ID if it's a team project.",
    refLabel: "Project ID",
  },
  neon: {
    name: "Neon",
    reads: "How far back you can restore (history retention), whether the production branch is protected, and Neon's security advisor.",
    token: "Organization or account settings → API keys. Use a project-scoped key if your plan offers one.",
    ref: "Project → Settings → General → Project ID.",
    refLabel: "Project ID",
  },
};

function ProviderRow({ repositoryId, provider, connected }: { repositoryId: string; provider: Provider; connected: Connected | undefined }) {
  const info = INFO[provider];
  const [current, setCurrent] = useState(connected?.projectRef ?? null);
  const [open, setOpen] = useState(false);
  const [projectRef, setProjectRef] = useState("");
  const [teamId, setTeamId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/providers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "POST" ? { repositoryId, provider, projectRef, teamId, token } : { repositoryId, provider }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setCurrent(method === "POST" ? projectRef : null);
      setMessage(method === "POST" ? (data.message ?? "Connected") : `Disconnected. Revoke the token in ${info.name} too.`);
      setOpen(false);
      setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {info.name} {current ? <Badge tone="good">Connected</Badge> : null}
          </p>
          <p className="mt-1 text-sm text-zinc-400">{info.reads}</p>
          {current ? <p className="mt-1 break-all font-mono text-xs text-zinc-500">{current}</p> : null}
        </div>
        {current ? (
          <Button variant="ghost" disabled={loading} onClick={() => void call("DELETE")}>
            Disconnect
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(!open)}>
            {open ? "Cancel" : "Connect"}
          </Button>
        )}
      </div>
      {open && !current ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void call("POST");
          }}
        >
          <p className="text-xs text-zinc-500">{info.ref}</p>
          <Input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder={info.refLabel} aria-label={info.refLabel} required />
          {provider === "vercel" ? <Input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="Team ID (optional)" aria-label="Team ID" /> : null}
          <p className="text-xs text-zinc-500">{info.token}</p>
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token" type="password" aria-label="Token" autoComplete="off" required />
          <Button type="submit" disabled={loading}>
            {loading ? "Checking…" : `Connect ${info.name}`}
          </Button>
        </form>
      ) : null}
      {message ? <p className="mt-2 text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

export function ProviderConnections({ repositoryId, connected }: { repositoryId: string; connected: Connected[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {(["supabase", "vercel", "neon"] as const).map((p) => (
        <ProviderRow key={p} repositoryId={repositoryId} provider={p} connected={connected.find((c) => c.provider === p)} />
      ))}
    </div>
  );
}
