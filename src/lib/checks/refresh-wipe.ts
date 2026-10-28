import { isSourceFile } from "@/lib/checks/collect-files";
import { balancedArgs } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

/** A delete scoped by one of these is usually already limited to the rows this job owns. */
const OWNERSHIP_COLUMN = /\b(?:source|origin|kind|type|provider|createdBy|created_by|owner|feature|job|generator)\b/i;

type Op = { table: string; file: string; index: number; scope: string | null };

function drizzleOps(f: RepoFile) {
  const deletes: Op[] = [];
  const inserts: Op[] = [];
  for (const m of f.content.matchAll(/\.delete\(\s*(\w+)\s*\)/g)) {
    // The delete's own chain: everything up to the end of the statement.
    const tail = f.content.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const stop = tail.search(/;|\n\s*\n|\bawait\b/);
    const chain = stop === -1 ? tail : tail.slice(0, stop);
    const where = chain.indexOf(".where(");
    const scope = where === -1 ? null : balancedArgs(chain, where + ".where".length) ?? chain.slice(where);
    deletes.push({ table: m[1], file: f.path, index: m.index, scope });
  }
  for (const m of f.content.matchAll(/\.insert\(\s*(\w+)\s*\)/g)) inserts.push({ table: m[1], file: f.path, index: m.index, scope: null });
  return { deletes, inserts };
}

function prismaOps(f: RepoFile) {
  const deletes: Op[] = [];
  const inserts: Op[] = [];
  for (const m of f.content.matchAll(/\b\w+\.(\w+)\.deleteMany\s*\(/g)) {
    const args = balancedArgs(f.content, m.index + m[0].length - 1) ?? "";
    deletes.push({ table: m[1], file: f.path, index: m.index, scope: /\bwhere\s*:/.test(args) ? args : null });
  }
  for (const m of f.content.matchAll(/\b\w+\.(\w+)\.(?:create|createMany|upsert)\s*\(/g)) inserts.push({ table: m[1], file: f.path, index: m.index, scope: null });
  return { deletes, inserts };
}

function sqlOps(f: RepoFile) {
  const deletes: Op[] = [];
  const inserts: Op[] = [];
  for (const m of f.content.matchAll(/\bDELETE\s+FROM\s+["`]?(\w+)["`]?([^;`'"]{0,200})/gi)) {
    const where = /\bWHERE\b([\s\S]*)/i.exec(m[2]);
    deletes.push({ table: m[1].toLowerCase(), file: f.path, index: m.index, scope: where ? where[1] : null });
  }
  for (const m of f.content.matchAll(/\bINSERT\s+INTO\s+["`]?(\w+)["`]?/gi)) inserts.push({ table: m[1].toLowerCase(), file: f.path, index: m.index, scope: null });
  return { deletes, inserts };
}

/**
 * "Delete everything, then re-insert the fresh set" is a common way to
 * refresh derived rows. It silently destroys data when another feature also
 * writes to that table: the refresh deletes those rows too, and the other
 * feature's data just disappears the next time this job runs.
 */
export function checkRefreshWipe(files: RepoFile[]): CheckFinding[] {
  const deletes: Op[] = [];
  const inserts: Op[] = [];
  for (const f of files) {
    if (!isSourceFile(f) && !f.path.endsWith(".py")) continue;
    for (const ops of [drizzleOps(f), prismaOps(f), sqlOps(f)]) {
      deletes.push(...ops.deletes);
      inserts.push(...ops.inserts);
    }
  }

  const out: CheckFinding[] = [];
  const seen = new Set<string>();
  for (const del of deletes) {
    const key = `${del.file}:${del.table}`;
    if (seen.has(key)) continue;
    // Refresh pattern: the same file deletes and then inserts into the same table.
    const reinserts = inserts.some((i) => i.file === del.file && i.table === del.table && i.index > del.index);
    if (!reinserts) continue;
    const otherWriters = [...new Set(inserts.filter((i) => i.table === del.table && i.file !== del.file).map((i) => i.file))];
    if (otherWriters.length === 0) continue;
    if (del.scope && OWNERSHIP_COLUMN.test(del.scope)) continue;
    seen.add(key);

    const content = files.find((f) => f.path === del.file)?.content ?? "";
    const scopeText = del.scope
      ? `It's scoped by \`${del.scope.replace(/\s+/g, " ").trim().slice(0, 120)}\`, which doesn't say which feature a row belongs to`
      : "It has no `where`, so it deletes every row in the table";
    out.push({
      severity: "MEDIUM",
      category: "database",
      title: `Refresh of \`${del.table}\` may delete rows written by another feature`,
      description: [
        `This code deletes from \`${del.table}\` and then re-inserts its own rows. ${scopeText}.`,
        "",
        `But ${otherWriters.length === 1 ? "another file also writes" : `${otherWriters.length} other files also write`} to \`${del.table}\`:`,
        ...otherWriters.slice(0, 5).map((w) => `- ${w}`),
        "",
        "Each time this refresh runs, rows those features created are deleted along with the stale ones — the kind of data loss nobody notices until a user asks where their data went.",
        "",
        "Needs review: Boswell matched the delete/insert pattern by table name; check whether those rows can actually overlap.",
      ].join("\n"),
      filePath: del.file,
      lineStart: lineOf(content, del.index),
      recommendation: `Add a column that records which feature wrote each row (e.g. \`source\`) and scope this delete to its own rows: \`.where(and(…, eq(${del.table}.source, "…")))\`. Or upsert by a stable key instead of delete-and-reinsert.`,
      confidence: 0.45,
    });
  }
  return out;
}
