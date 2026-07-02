import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { Badge, Card } from "@/components/ui";

export function CoachingCard({
  coaching,
  title,
  showEli5,
}: {
  coaching: CoachingSections;
  title: string;
  showEli5?: boolean;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-white">{title}</h3>
        <Badge tone="neutral">Confidence {Math.round(coaching.confidence * 100)}%</Badge>
        <Badge
          tone={
            coaching.autoFixStatus === "safe"
              ? "good"
              : coaching.autoFixStatus === "manual"
                ? "bad"
                : "warn"
          }
        >
          {coaching.autoFixStatus === "safe"
            ? "Safe to auto-fix"
            : coaching.autoFixStatus === "manual"
              ? "Manual fix recommended"
              : "Needs human review"}
        </Badge>
      </div>

      <Section title="What happened?">{coaching.whatHappened}</Section>
      {coaching.whyGood ? <Section title="Why is this good?">{coaching.whyGood}</Section> : null}
      {coaching.whyBad ? <Section title="Why is this bad?">{coaching.whyBad}</Section> : null}
      {coaching.whyDangerous ? (
        <Section title="Why is this dangerous?">{coaching.whyDangerous}</Section>
      ) : null}
      {coaching.whyAiGenerated ? (
        <Section title="Why did AI probably generate this?">{coaching.whyAiGenerated}</Section>
      ) : null}
      <Section title="How should a human think about this?">{coaching.howToThink}</Section>
      <Section title="How do I fix it?">
        <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300">{coaching.howToFix}</pre>
      </Section>
      <Section title="Can Boswell fix this automatically?">{coaching.autoFixReason}</Section>
      <Section title="What happens if I ignore this?">{coaching.ifIgnored}</Section>
      {showEli5 ? (
        <Section title="Explain like I'm new">{coaching.explainLikeImNew}</Section>
      ) : null}

      <div className="text-xs text-zinc-500">
        Evidence: {coaching.evidence.join(" · ")}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-medium text-zinc-200">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-zinc-400">{children}</p>
    </div>
  );
}
