import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const checkSources = fs
  .readdirSync(path.join(root, "src/lib/checks"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => `src/lib/checks/${f}`);

describe("repo check security invariants", () => {
  it("only the isolated npm runner can spawn processes", () => {
    for (const file of checkSources) {
      if (file.endsWith("npm-audit.ts")) continue;
      expect(read(file), file).not.toMatch(/child_process|execSync|spawn\(/);
    }
  });

  it("never lets npm run scripts, install packages, or see the worker's environment", () => {
    const runner = read("src/lib/checks/npm-audit.ts");
    expect(runner).toContain('"--package-lock-only"');
    expect(runner).toContain('"--ignore-scripts"');
    expect(runner).toContain("https://registry.npmjs.org/");
    expect(runner).not.toMatch(/\.\.\.process\.env/);
    expect(runner).not.toMatch(/env:\s*process\.env/);
    expect(runner).toMatch(/execFile\("npm"/);
  });

  it("the worker never installs, builds or runs the audited repository", () => {
    const worker = read("src/lib/worker/process-audit.ts");
    expect(worker).not.toMatch(/\bnpm (?:ci|install|run|test)\b|\byarn |\bpnpm |\bnpx /);
    expect(worker).not.toMatch(/execFileSync\(\s*"(?:npm|npx|yarn|pnpm|node|bun)"/);
  });
});
