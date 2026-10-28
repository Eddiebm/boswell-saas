import { processWorkerTick, recoverStaleAudits } from "../src/lib/audits";
import { processVerifyWorkerTick } from "../src/lib/dynamic-verify/run";
import { flushMonitoring, initWorkerMonitoring, reportError } from "../src/lib/monitoring";

initWorkerMonitoring();

/** Exiting straight away would drop error reports still being sent. */
async function exit(code: number): Promise<never> {
  await flushMonitoring();
  process.exit(code);
}

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
    await exit(result.ok ? 0 : 1);
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
    await exit(verifyResult.ok ? 0 : 1);
  }

  console.log(JSON.stringify({ processed: false, message: "No queued audits or verification runs" }));
  await flushMonitoring();
}

main().catch(async (error) => {
  console.error(error);
  reportError(error, { component: "worker" });
  await exit(1);
});
