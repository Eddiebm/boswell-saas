import http from "node:http";
import { processWorkerTick } from "../src/lib/audits";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function startHealthServer() {
  const port = Number(process.env.PORT ?? 10000);
  http
    .createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("boswell-worker-ok");
    })
    .listen(port, "0.0.0.0", () => {
      console.log(`Health server listening on ${port}`);
    });
}

async function main() {
  if (
    process.env.BOSWELL_CLOUD_WORKER !== "1" &&
    process.env.BOSWELL_ALLOW_LOCAL_WORKER !== "1"
  ) {
    console.error(
      "Local worker disabled. Audits run on GitHub Actions. Set BOSWELL_ALLOW_LOCAL_WORKER=1 to run locally.",
    );
    process.exit(1);
  }

  startHealthServer();
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
