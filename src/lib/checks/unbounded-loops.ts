import { isServerFile, isSourceFile, isTestFile } from "@/lib/checks/collect-files";
import { balancedArgs, balancedBlock, maskNonCode, stripComments } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

const MAX_LISTED = 10;

/** A call that costs money every time: an AI provider, directly or through a wrapper named like one. */
const LLM_CALL = new RegExp(
  [
    String.raw`\.chat\.completions\.create`,
    String.raw`\.completions\.create`,
    String.raw`\.messages\.create`,
    String.raw`\.responses\.create`,
    String.raw`\.generateContent\s*\(`,
    String.raw`\b(?:generateText|streamText|generateObject|streamObject)\s*\(`,
    String.raw`\bnew\s+(?:OpenAI|Anthropic|GoogleGenerativeAI|Groq|Mistral|Cohere)\b`,
    String.raw`\b(?:agent|executor|chain|llm|model)\.(?:invoke|run|call|predict|generate|step)\s*\(`,
    String.raw`\b(?:ask|call|run|query)(?:LLM|Llm|Model|OpenAI|OpenRouter|Claude|GPT|AI|Agent)\w*\s*\(`,
    String.raw`fetch\([^)]*(?:openai\.com|anthropic\.com|openrouter\.ai|generativelanguage|api\.groq|api\.together|api\.mistral|api\.cohere|api\.x\.ai)`,
    // Python
    String.raw`\b(?:ChatOpenAI|ChatAnthropic|litellm\.completion|generate_content|call_llm|run_agent)\b`,
  ].join("|"),
);
/** Actions that are hard to take back: sending, publishing, charging, deleting, spending, running commands. */
const SIDE_EFFECT = /\b(?:send\w*|publish\w*|charge\w*|refund\w*|(?:launch|create|update|pause)Campaign\w*|(?:update|set)Budget\w*|delete\w*|drop\w*|remove\w*|(?:exec|spawn)(?:Sync)?|writeFile(?:Sync)?|unlink(?:Sync)?|rm(?:Sync)?|subprocess\.\w+|os\.system)\s*\(/;
/**
 * A real stop on the loop itself: a counter, a limit or a deadline that gets *compared*, or a clock check. A per-request
 * option (`max_tokens`, `maxRetries`, `timeout`, `AbortSignal.timeout`) limits one call, not how many times the loop runs
 * or what it spends in total, and a flag the model itself sets ("done") isn't a stop at all.
 */
const COUNTER = "(?:i|j|n|step|steps|iter|iteration|iterations|turn|turns|attempt|attempts|retry|retries|count|tries|round|rounds)";
const LIMIT = String.raw`[\w.]*(?:max|MAX|Max|limit|Limit|LIMIT|budget|Budget|BUDGET|deadline|Deadline|DEADLINE|cap|Cap)\w*`;
const BOUND = new RegExp(
  [
    // A counter compared with something: `round < MAX`, `if (++turns > 10)`, `attempts >= 5`. Counting alone is not a limit.
    String.raw`\b${COUNTER}\s*(?:\+\+|--)?\s*(?:<=?|>=?)`,
    String.raw`(?:<=?|>=?)\s*${COUNTER}\b`,
    String.raw`(?:\+\+|--)\s*${COUNTER}\s*(?:<=?|>=?)`,
    // Something compared with a limit-named value: `spent > MAX_COST`, `elapsed >= deadline`, `calls < budget`.
    String.raw`(?:<=?|>=?)\s*${LIMIT}`,
    String.raw`${LIMIT}\s*(?:<=?|>=?)`,
    // A clock or an abort check inside the loop.
    String.raw`signal\??\.aborted|Date\.now\(\)\s*[-<>]|\bperformance\.now\(\)|\brange\(`,
  ].join("|"),
);
/** Loop conditions the model or a flag decides, not a count. */
const MODEL_DRIVEN = /tool_calls|toolCalls|tool_use|stop_reason|stopReason|finish_reason|finishReason|hasMore|needsMore|\bdone\b|\bfinished\b|\bcomplete\b/i;
const NO_LIMIT_SETTING = /\bmax_?(?:steps|iterations|turns|rounds)\s*[:=]\s*(?:Infinity|None|null|-1|\d{3,})|\brecursion_?limit\s*[:=]\s*\d{3,}|\bstopWhen\s*:\s*\(\s*\)\s*=>\s*false/i;

function openEnded(condition: string): boolean {
  const c = condition.trim();
  return c === "" || /^(?:true|1|True)$/.test(c) || /^!\s*[\w.?]+$/.test(c) || /^not\s+\w+$/.test(c) || /===?\s*false|==\s*False/.test(c) || MODEL_DRIVEN.test(c);
}

type Loop = { line: number; effects: boolean; llm: boolean; network: boolean };

/** Loops in JS/TS: `while (open-ended)` and `for (;;)`, with their bodies. */
function jsLoops(f: RepoFile): { loops: Loop[]; intervals: Loop[] } {
  const code = maskNonCode(f.content);
  const loops: Loop[] = [];
  const intervals: Loop[] = [];
  const consider = (headerStart: number, condition: string, bodyOpen: number) => {
    const maskedBody = balancedBlock(code, bodyOpen);
    if (maskedBody === null) return;
    const body = stripComments(f.content.slice(bodyOpen + 1, bodyOpen + 1 + maskedBody.length));
    if (!openEnded(condition) || BOUND.test(`${condition}\n${body}`)) return;
    loops.push({ line: lineOf(f.content, headerStart), effects: SIDE_EFFECT.test(body), llm: LLM_CALL.test(body), network: /\bfetch\s*\(|\baxios\b/.test(body) && /\bcatch\b/.test(body) && /\bsleep\b|\bdelay\b|setTimeout|\bcontinue\b/.test(body) });
  };

  for (const m of code.matchAll(/\bwhile\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const condition = balancedArgs(code, open);
    if (condition === null) continue;
    let after = open + condition.length + 2;
    while (/\s/.test(code[after] ?? "")) after++;
    if (code[after] === "{") consider(m.index, f.content.slice(open + 1, open + 1 + condition.length), after);
  }
  for (const m of code.matchAll(/\bfor\s*\(\s*;\s*;\s*\)\s*\{/g)) consider(m.index, "", m.index + m[0].length - 1);

  // setInterval with a paid call or a side effect inside, in a file that never clears it.
  for (const m of code.matchAll(/\bsetInterval\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = balancedArgs(code, open);
    if (args === null) continue;
    const body = stripComments(f.content.slice(open + 1, open + 1 + args.length));
    if ((LLM_CALL.test(body) || SIDE_EFFECT.test(body)) && !/\bclearInterval\b/.test(f.content)) {
      intervals.push({ line: lineOf(f.content, m.index), effects: SIDE_EFFECT.test(body), llm: LLM_CALL.test(body), network: false });
    }
  }
  return { loops, intervals };
}

/** `while True:`-style loops in Python, by indentation. */
function pythonLoops(f: RepoFile): Loop[] {
  const rows = f.content.split("\n");
  const out: Loop[] = [];
  rows.forEach((row, i) => {
    const m = /^(\s*)while\s+(.+?)\s*:\s*(?:#.*)?$/.exec(row);
    if (!m || !openEnded(m[2])) return;
    const indent = m[1].length;
    const body: string[] = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].trim() === "") continue;
      if (rows[j].length - rows[j].trimStart().length <= indent) break;
      body.push(rows[j].replace(/#.*$/, ""));
    }
    const text = body.join("\n");
    if (BOUND.test(`${m[2]}\n${text}`)) return;
    out.push({ line: i + 1, effects: SIDE_EFFECT.test(text), llm: LLM_CALL.test(text), network: false });
  });
  return out;
}

function listing(spots: Array<{ file: string; line: number }>): string[] {
  const shown = spots.slice(0, MAX_LISTED);
  return [...shown.map((s) => `- ${s.file}:${s.line}`), ...(spots.length > shown.length ? [`- …and ${spots.length - shown.length} more`] : [])];
}

/**
 * Code that keeps going on its own. A task has a finish line; a loop that
 * calls an AI model until the model says it's done doesn't, and every round
 * is billed and can act. Looks for:
 * - open-ended loops (and intervals) that call a model or take an action, with
 *   no counter, limit, deadline or budget,
 * - agent settings that remove the framework's step limit,
 * - retry-forever loops around network calls (a note only).
 * Pattern-based, so every finding asks for review.
 */
export function checkUnboundedLoops(files: RepoFile[]): CheckFinding[] {
  const aiLoops: Array<{ file: string; line: number; effects: boolean }> = [];
  const retries: Array<{ file: string; line: number }> = [];
  const noLimit: Array<{ file: string; line: number }> = [];

  for (const f of files) {
    const isPython = /\.py$/.test(f.path);
    if (isTestFile(f) || (!isPython && (!isSourceFile(f) || !isServerFile(f)))) continue;
    const loops = isPython ? pythonLoops(f) : jsLoops(f);
    const found = Array.isArray(loops) ? { loops, intervals: [] as Loop[] } : loops;
    for (const l of found.loops) {
      if (l.llm) aiLoops.push({ file: f.path, line: l.line, effects: l.effects });
      else if (l.network) retries.push({ file: f.path, line: l.line });
    }
    for (const l of found.intervals) aiLoops.push({ file: f.path, line: l.line, effects: l.effects });
    const setting = NO_LIMIT_SETTING.exec(stripComments(f.content));
    if (setting) noLimit.push({ file: f.path, line: lineOf(f.content, setting.index) });
  }

  const out: CheckFinding[] = [];
  if (aiLoops.length) {
    const acts = aiLoops.some((l) => l.effects);
    out.push({
      ruleId: "habits.unbounded-loop",
      severity: acts ? "HIGH" : "MEDIUM",
      category: "reliability",
      title: `${aiLoops.length} ${aiLoops.length === 1 ? "loop calls" : "loops call"} an AI model with no limit${acts ? " and can take actions" : ""}`,
      description: [
        "These loops keep running until a flag or the model itself says stop. There is no counter, deadline or spending limit, so one bad answer (the model never says \"done\") means it runs, and bills you, until something else kills it." + (acts ? " They also send, delete, publish or run things inside the loop, so a runaway round repeats the action." : ""),
        "",
        ...listing(aiLoops),
        "",
        "Needs review: a limit set somewhere Boswell can't see (a wrapper, the provider's own cap) would make one of these fine.",
      ].join("\n"),
      filePath: aiLoops[0].file,
      lineStart: aiLoops[0].line,
      recommendation: "Give every loop a finish line: a maximum number of rounds, a time limit and a cost limit, and stop with a clear error when one is hit. For loops that take actions, require a person's approval before the action.",
      confidence: 0.6,
    });
  }
  if (noLimit.length) {
    out.push({
      ruleId: "habits.agent-no-limit",
      severity: "MEDIUM",
      category: "reliability",
      title: "An agent's step limit is switched off or set very high",
      description: ["Agent frameworks stop after a handful of steps by default. These settings remove that safety.", "", ...listing(noLimit), "", "Needs review: a very high limit can be deliberate if something else caps spend."].join("\n"),
      filePath: noLimit[0].file,
      lineStart: noLimit[0].line,
      recommendation: "Set a small maximum (10 to 25 steps) and a spending limit with your AI provider.",
      confidence: 0.7,
    });
  }
  if (retries.length) {
    out.push({
      ruleId: "habits.unbounded-retry",
      severity: "LOW",
      category: "reliability",
      title: `${retries.length} ${retries.length === 1 ? "loop retries" : "loops retry"} a network call forever`,
      description: ["These loops try again after a failure with no maximum. If the other side is down, they hammer it (and your bill, or its rate limit) until something stops them.", "", ...listing(retries), "", "Needs review: a worker that should run forever is fine if each round backs off."].join("\n"),
      filePath: retries[0].file,
      lineStart: retries[0].line,
      recommendation: "Cap the attempts (3 to 5), wait longer after each failure, and report the failure when the cap is reached.",
      confidence: 0.5,
    });
  }
  return out;
}
