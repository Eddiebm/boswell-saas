import Link from "next/link";
import { auth, signIn } from "@/lib/auth";
import { Button, Card } from "@/components/ui";
import { publicPlanSummary } from "@/lib/stripe";
import { isDemoMode } from "@/lib/demo/mode";

const faq = [
  {
    q: "What is Boswell?",
    a: "Boswell is your AI Engineering CTO. It watches repositories, remembers what changed, scores health, and tells you what to fix next — in plain English.",
  },
  {
    q: "Does Boswell push to main?",
    a: "Never. Safe fixes open PRs on branches for human review. Dangerous changes are manual only.",
  },
  {
    q: "What is the AI Slop Score?",
    a: "A deterministic scan for patterns common in low-quality AI-generated code. It is an indicator, not proof.",
  },
  {
    q: "Do I need GitHub and Neon to try it?",
    a: "No. Run demo mode locally with zero credentials. Connect GitHub + Neon for live audits.",
  },
];

export default async function HomePage() {
  const session = await auth();
  const demo = isDemoMode();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937_0%,#000_55%)] text-white">
      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-20">
        <section className="max-w-3xl">
          <p className="mb-4 text-sm uppercase tracking-[0.2em] text-zinc-400">Boswell</p>
          <h1 className="text-5xl font-semibold tracking-tight">
            Every repository gets an AI Engineering CTO.
          </h1>
          <p className="mt-6 text-lg leading-8 text-zinc-300">
            Boswell watches your code, remembers what changed, and tells you what is good, bad, dangerous, and fixable — built for teams using AI coding tools.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            {demo ? (
              <Button href="/dashboard">Open demo dashboard</Button>
            ) : session ? (
              <Button href="/dashboard">Open dashboard</Button>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo: "/dashboard" });
                }}
              >
                <Button type="submit">Sign in with GitHub</Button>
              </form>
            )}
            <Button href="#pricing" variant="secondary">
              Pricing
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="text-lg font-medium">The problem</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              AI writes code faster than teams can review it. Security gaps, slop, and tech debt pile up. Founders lack a trusted engineering voice.
            </p>
          </Card>
          <Card>
            <h2 className="text-lg font-medium">The solution</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Boswell audits every repo, scores health deterministically, coaches your team, prioritizes fixes, and opens safe PRs — never to main.
            </p>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Daily CTO Briefing", "Morning update: changes, risks, top priority, safe PRs, debt hours."],
            ["Engineering Memory", "Evidence-based history — what changed, what regressed, what you ignored."],
            ["Coaching Mode", "Every finding explains good, bad, dangerous — at an 8th-grade reading level."],
            ["Prioritization", "Fix queue sorted by value. Ignore most findings. Fix these first."],
            ["Safe PRs", "Green / yellow / red automation policy. PRs only, never auto-merge."],
            ["AI Slop Score", "Detect boilerplate, TODOs, fake completeness — with human review confidence."],
          ].map(([title, body]) => (
            <Card key={title}>
              <h2 className="text-lg font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
            </Card>
          ))}
        </section>

        <section id="pricing" className="space-y-6">
          <h2 className="text-3xl font-semibold">Pricing</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {publicPlanSummary().map((plan) => (
              <Card key={plan.id}>
                <h3 className="text-xl font-medium">{plan.name}</h3>
                <p className="mt-2 text-3xl font-semibold">
                  {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}/mo`}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-zinc-400">
                  {plan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-3xl font-semibold">FAQ</h2>
          {faq.map((item) => (
            <Card key={item.q}>
              <h3 className="font-medium">{item.q}</h3>
              <p className="mt-2 text-sm text-zinc-400">{item.a}</p>
            </Card>
          ))}
        </section>

        <section className="text-center">
          <h2 className="text-2xl font-semibold">Start with the Daily CTO Briefing</h2>
          <p className="mt-2 text-zinc-400">Connect a repo or open the demo — your morning engineering update is one click away.</p>
          <div className="mt-6">
            <Button href="/dashboard">Get started</Button>
          </div>
        </section>

        <footer className="text-sm text-zinc-500">
          Powered by the open{" "}
          <Link href="https://github.com/Eddiebm/boswell" className="underline">
            Boswell engine
          </Link>
          . Docs in <code className="text-zinc-400">docs/</code>.
        </footer>
      </main>
    </div>
  );
}
