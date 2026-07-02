import { processWorkerTick } from "../src/lib/audits";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("Boswell worker started");
  while (true) {
    try {
      const result = await processWorkerTick();
      if (result.processed && "auditId" in result) {
        console.log(`Processed audit ${result.auditId}`, result.ok ? "ok" : result.error);
      } else {
        await sleep(5000);
      }
    } catch (error) {
      console.error("Worker tick failed", error);
      await sleep(5000);
    }
  }
}

void main();
