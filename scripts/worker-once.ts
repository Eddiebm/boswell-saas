import { processWorkerTick, recoverStuckAudits } from "../src/lib/audits";

async function main() {
  await recoverStuckAudits();
  const result = await processWorkerTick();
  if (result.processed && "auditId" in result) {
    console.log(
      JSON.stringify({
        processed: true,
        auditId: result.auditId,
        ok: result.ok,
        error: "error" in result ? result.error : undefined,
      }),
    );
    process.exit(result.ok ? 0 : 1);
  }
  console.log(JSON.stringify({ processed: false, message: "No queued audits" }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
