/**
 * Lightweight source scanning for the pattern-based checks. These aren't
 * parsers — they skip strings and comments well enough to find call
 * arguments, which is all the checks need, and every check built on them
 * reports its findings as "needs review".
 */

/** Text between the parenthesis at `openIndex` and its match (exclusive), or null if unbalanced within `limit`. */
export function balancedArgs(content: string, openIndex: number, limit = 4000): string | null {
  if (content[openIndex] !== "(") return null;
  let depth = 0;
  let quote: string | null = null;
  const end = Math.min(content.length, openIndex + limit);
  for (let i = openIndex; i < end; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "/" && content[i + 1] === "/") i = content.indexOf("\n", i) === -1 ? end : content.indexOf("\n", i);
    else if (ch === "/" && content[i + 1] === "*") i = content.indexOf("*/", i) === -1 ? end : content.indexOf("*/", i) + 1;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Splits call arguments on top-level commas (template-literal interpolations are kept intact). */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = args.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Every `name(` call site: index of the name and the call's argument text. */
export function findCalls(content: string, name: RegExp): Array<{ index: number; args: string }> {
  const out: Array<{ index: number; args: string }> = [];
  const re = new RegExp(`(?<![\\w$.])(?:${name.source})\\s*\\(`, "g");
  for (const m of content.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const args = balancedArgs(content, open);
    if (args !== null) out.push({ index: m.index, args });
  }
  return out;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips line and block comments so commented-out code doesn't count as usage. Strings are left intact. */
export function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
