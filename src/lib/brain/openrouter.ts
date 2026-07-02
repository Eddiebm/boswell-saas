export type OpenRouterAnswer = {
  answer: string;
  model: string;
};

export async function askOpenRouter(
  question: string,
  evidenceContext: string,
): Promise<OpenRouterAnswer | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL ?? "openrouter/auto";

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.AUTH_URL ?? "https://boswell-saas.vercel.app",
      "X-Title": "Boswell SaaS",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You are Boswell, an AI Engineering CTO.",
            "Answer using ONLY the evidence in the context below.",
            "Cite file paths, audit findings, or memory events when possible.",
            "Use simple language (8th–10th grade).",
            "If evidence is insufficient, say what is missing — do not invent history.",
            "End with a short 'Evidence used:' bullet list.",
          ].join(" "),
        },
        {
          role: "user",
          content: `## Repository evidence\n${evidenceContext}\n\n## Question\n${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) return null;

  return { answer, model: json.model ?? model };
}

export function buildEvidenceContext(input: {
  repoName: string;
  score: number;
  slopPercent: number;
  briefingSummary: string;
  topFindings: string[];
  memoryEvents: string[];
  fixQueue: string[];
  riskyFiles: string[];
}): string {
  return [
    `Repository: ${input.repoName}`,
    `Health score: ${input.score}/1000`,
    `AI Slop: ${input.slopPercent}% (indicators only)`,
    `Briefing: ${input.briefingSummary}`,
    `Top findings: ${input.topFindings.join("; ") || "none"}`,
    `Fix queue: ${input.fixQueue.join("; ") || "empty"}`,
    `Memory: ${input.memoryEvents.join("; ") || "none"}`,
    `Risky files: ${input.riskyFiles.join(", ") || "none"}`,
  ].join("\n");
}
