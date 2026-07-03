import { desc, eq } from "drizzle-orm";
import { requeueFailedAudit } from "../src/lib/audits";
import { requireDb } from "../src/lib/db";
import { auditRuns } from "../src/lib/db/schema";

async function main() {
  const auditId = process.argv[2];
  const db = requireDb();

  const targetId =
    auditId ??
    (
      await db
        .select({ id: auditRuns.id })
        .from(auditRuns)
        .where(eq(auditRuns.status, "failed"))
        .orderBy(desc(auditRuns.finishedAt))
        .limit(1)
    )[0]?.id;

  if (!targetId) {
    console.log(JSON.stringify({ requeued: false, message: "No failed audits" }));
    return;
  }

  const run = await requeueFailedAudit(targetId);
  console.log(JSON.stringify({ requeued: true, auditId: run.id }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
