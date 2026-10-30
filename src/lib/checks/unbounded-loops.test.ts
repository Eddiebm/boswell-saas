import { describe, expect, it } from "vitest";
import { checkUnboundedLoops } from "@/lib/checks/unbounded-loops";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content: string): RepoFile => ({ path, content });
const run = (...files: RepoFile[]) => checkUnboundedLoops(files).map((f) => `${f.ruleId}:${f.severity}`);

describe("loops that call an AI model with no limit", () => {
  it("flags a while(true) agent loop that only the model can stop", () => {
    const f = file(
      "src/lib/agent.ts",
      `export async function runAgent(task: string) {
  let done = false;
  while (!done) {
    const reply = await openai.chat.completions.create({ model, messages });
    done = reply.choices[0].finish_reason === "stop";
  }
}
`,
    );
    expect(run(f)).toEqual(["habits.unbounded-loop:MEDIUM"]);
  });

  it("flags a tool-calling loop and raises it to HIGH when the loop takes actions", () => {
    const f = file(
      "src/lib/agent.ts",
      `export async function runAgent() {
  let response = await anthropic.messages.create(args);
  while (response.stop_reason === "tool_use") {
    await sendEmail(response.content);
    response = await anthropic.messages.create(args);
  }
}
`,
    );
    expect(run(f)).toEqual(["habits.unbounded-loop:HIGH"]);
  });

  it("flags for(;;) and a wrapper named like a model call", () => {
    const f = file("src/worker.ts", "for (;;) {\n  const text = await askOpenRouter(prompt);\n  await save(text);\n}\n");
    expect(run(f)).toEqual(["habits.unbounded-loop:MEDIUM"]);
  });

  it("flags a Python agent loop", () => {
    const f = file("agent.py", "def run():\n    while True:\n        out = client.messages.create(model=m, messages=msgs)\n        msgs.append(out)\n");
    expect(run(f)).toEqual(["habits.unbounded-loop:MEDIUM"]);
  });

  it("flags a setInterval that calls a model and is never cleared", () => {
    const f = file("src/cron.ts", "setInterval(async () => {\n  await generateText({ model, prompt });\n}, 60_000);\n");
    expect(run(f)).toEqual(["habits.unbounded-loop:MEDIUM"]);
    expect(run(file("src/cron.ts", "const t = setInterval(async () => { await generateText({ model, prompt }); }, 1000);\nclearInterval(t);\n"))).toEqual([]);
  });

  it("accepts loops with a counter, a deadline or a budget", () => {
    const counted = file("src/a.ts", "let turns = 0;\nwhile (true) {\n  if (++turns > 10) break;\n  await openai.chat.completions.create(args);\n}\n");
    const deadline = file("src/b.ts", "while (Date.now() < deadline) {\n  await openai.chat.completions.create(args);\n}\n");
    const budget = file("src/c.ts", "while (!done) {\n  if (spent > MAX_COST) throw new Error('budget');\n  await callLLM(p);\n}\n");
    const bounded = file("src/d.ts", "for (let i = 0; i < 5; i++) {\n  await openai.chat.completions.create(args);\n}\n");
    expect(run(counted, deadline, budget, bounded)).toEqual([]);
    expect(run(file("agent.py", "def run():\n    while True:\n        if attempts >= MAX_TURNS:\n            break\n        client.messages.create(m)\n"))).toEqual([]);
  });

  it("does not mistake per-request options for a limit on the loop", () => {
    const js = file("src/a.ts", "while (true) {\n  await openai.chat.completions.create({ model, messages, maxTokens: 1000, max_tokens: 1000, timeout: 30_000, signal: AbortSignal.timeout(5000), maxRetries: 2 });\n}\n");
    expect(run(js)).toEqual(["habits.unbounded-loop:MEDIUM"]);
    const py = file("agent.py", "def run():\n    while True:\n        out = client.messages.create(model=m, max_tokens=1024, timeout=30, messages=msgs)\n");
    expect(run(py)).toEqual(["habits.unbounded-loop:MEDIUM"]);
    // A limit that is actually compared still counts.
    const compared = file("src/b.ts", "while (true) {\n  if (spent > maxCost) break;\n  await openai.chat.completions.create({ max_tokens: 1000 });\n}\n");
    expect(run(compared)).toEqual([]);
    const clock = file("src/c.ts", "while (!done) {\n  if (Date.now() - started > TIME_LIMIT_MS) break;\n  await callLLM(p);\n}\n");
    expect(run(clock)).toEqual([]);
  });

  it("does not count a counter that is only incremented, never compared", () => {
    const f = file("src/a.ts", "let round = 0;\nwhile (true) {\n  round++;\n  await openai.chat.completions.create(args);\n}\n");
    expect(run(f)).toEqual(["habits.unbounded-loop:MEDIUM"]);
    const checked = file("src/b.ts", "let round = 0;\nwhile (round < MAX_TOOL_ROUNDS) {\n  round++;\n  await openai.chat.completions.create(args);\n}\n");
    expect(run(checked)).toEqual([]);
  });

  it("ignores loops that don't call a model, tests, client components and examples in strings", () => {
    const plain = file("src/queue.ts", "while (true) {\n  const job = await next();\n  await handle(job);\n}\n");
    const test = file("src/a.test.ts", "while (true) {\n  await openai.chat.completions.create(args);\n}\n");
    const client = file("src/ui.tsx", '"use client";\nwhile (true) {\n  await askOpenRouter(p);\n}\n');
    const text = file("src/doc.ts", 'export const tip = "never write while (true) { openai.chat.completions.create(x) }";\n// while (true) { callLLM(p) }\n');
    expect(run(plain, test, client, text)).toEqual([]);
  });
});

describe("agent step limits", () => {
  it("flags a limit that is removed or set very high", () => {
    expect(run(file("src/a.ts", "const agent = new AgentExecutor({ agent, tools, maxIterations: Infinity });\n"))).toEqual(["habits.agent-no-limit:MEDIUM"]);
    expect(run(file("agent.py", "executor = AgentExecutor(agent=a, tools=t, max_iterations=None)\n"))).toEqual(["habits.agent-no-limit:MEDIUM"]);
    expect(run(file("src/b.ts", "await generateText({ model, tools, maxSteps: 500 });\n"))).toEqual(["habits.agent-no-limit:MEDIUM"]);
  });

  it("accepts a sensible limit", () => {
    expect(run(file("src/a.ts", "await generateText({ model, tools, maxSteps: 10 });\nconst e = new AgentExecutor({ maxIterations: 15 });\n"))).toEqual([]);
  });
});

describe("retrying a network call forever", () => {
  it("notes a retry loop with no maximum", () => {
    const f = file("src/sync.ts", "while (true) {\n  try {\n    await fetch(url);\n    break;\n  } catch (e) {\n    await sleep(1000);\n  }\n}\n");
    expect(run(f)).toEqual(["habits.unbounded-retry:LOW"]);
  });

  it("accepts a capped retry", () => {
    const f = file("src/sync.ts", "let attempts = 0;\nwhile (true) {\n  try {\n    await fetch(url);\n    break;\n  } catch (e) {\n    if (++attempts >= 5) throw e;\n    await sleep(1000);\n  }\n}\n");
    expect(run(f)).toEqual([]);
  });
});
