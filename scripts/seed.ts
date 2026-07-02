/**
 * Database seed — run with DATABASE_URL set:
 *   npx tsx scripts/seed.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/db/schema";
import {
  demoBriefing,
  demoFindings,
  demoScore,
  demoSlop,
  DEMO_AUDIT_ID,
  DEMO_REPO_ID,
  DEMO_USER_ID,
} from "../src/lib/demo/data";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  const db = drizzle(neon(url), { schema });

  const [user] = await db
    .insert(schema.users)
    .values({
      id: DEMO_USER_ID,
      name: "Demo User",
      email: "demo@boswell.local",
      githubLogin: "eddiebm",
      plan: "pro",
    })
    .onConflictDoNothing()
    .returning();

  console.log("User:", user?.id ?? DEMO_USER_ID);

  const [repo] = await db
    .insert(schema.repositories)
    .values({
      id: DEMO_REPO_ID,
      userId: DEMO_USER_ID,
      githubId: 1,
      owner: "Eddiebm",
      name: "audiolens-app",
      fullName: "Eddiebm/audiolens-app",
      cloneUrl: "https://github.com/Eddiebm/audiolens-app.git",
      healthScore: demoScore.overall,
      slopPercent: demoSlop.overallPercent,
    })
    .onConflictDoNothing()
    .returning();

  console.log("Repo:", repo?.id ?? DEMO_REPO_ID);

  await db.insert(schema.auditRuns).values({
    id: DEMO_AUDIT_ID,
    userId: DEMO_USER_ID,
    repositoryId: DEMO_REPO_ID,
    status: "completed",
    summary: demoBriefing.executiveSummary,
    briefingJson: demoBriefing,
    slopJson: demoSlop,
    scoresJson: demoScore,
    finishedAt: new Date(),
  }).onConflictDoNothing();

  for (const f of demoFindings) {
    await db.insert(schema.findings).values({
      id: f.id,
      repositoryId: DEMO_REPO_ID,
      auditRunId: DEMO_AUDIT_ID,
      title: f.title,
      description: f.description,
      severity: f.severity,
      category: f.category,
      filePath: f.filePath,
      lineStart: f.lineStart,
      coaching: f.coaching,
      confidence: f.confidence,
      status: f.status,
    }).onConflictDoNothing();
  }

  console.log("Seed complete.");
}

void main();
