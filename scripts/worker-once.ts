import { processWorkerTick, recoverStaleAudits } from "../src/lib/audits";
import { processVerifyWorkerTick } from "../src/lib/dynamic-verify/run";

async function main() {
  await recoverStaleAudits();
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

  const verifyResult = await processVerifyWorkerTick();
  if (verifyResult.processed && "runId" in verifyResult) {
    console.log(
      JSON.stringify({
        processed: true,
        runId: verifyResult.runId,
        ok: verifyResult.ok,
        error: "error" in verifyResult ? verifyResult.error : undefined,
      }),
    );
    process.exit(verifyResult.ok ? 0 : 1);
  }

  console.log(JSON.stringify({ processed: false, message: "No queued audits or verification runs" }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
