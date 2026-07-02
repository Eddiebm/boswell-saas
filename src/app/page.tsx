import Link from "next/link";
import { auth, signIn } from "@/lib/auth";
import { Button, Card } from "@/components/ui";
import { publicPlanSummary } from "@/lib/stripe";

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937_0%,#000_55%)] text-white">
      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-20">
        <section className="max-w-3xl">
          <p className="mb-4 text-sm uppercase tracking-[0.2em] text-zinc-400">Boswell Cloud</p>
          <h1 className="text-5xl font-semibold tracking-tight">
            Turn any GitHub repo into a security audit and handoff report.
          </h1>
          <p className="mt-6 text-lg leading-8 text-zinc-300">
            Connect GitHub, run Boswell in the cloud, and get audit docs, leak findings,
            deploy verdicts, and handoff reports without installing anything locally.
          </p>
          <div className="mt-8 flex gap-4">
            {session ? (
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
              View pricing
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Leak scan", "Git history, working tree, and gitignore coverage."],
            ["AI audit", "Technical audit, handoff docs, and lessons learned."],
            ["SaaS dashboard", "Track repos, audits, findings, and billing in one place."],
          ].map(([title, body]) => (
            <Card key={title}>
              <h2 className="text-lg font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
            </Card>
          ))}
        </section>

        <section id="pricing" className="space-y-6">
          <h2 className="text-3xl font-semibold">Pricing</h2>
          <div className="grid gap-4 md:grid-cols-3">
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

        <footer className="text-sm text-zinc-500">
          Powered by the open{" "}
          <Link href="https://github.com/Eddiebm/boswell" className="underline">
            Boswell engine
          </Link>
          .
        </footer>
      </main>
    </div>
  );
}
