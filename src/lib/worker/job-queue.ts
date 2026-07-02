import { eq, and, lt } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { workerJobs } from "@/lib/db/schema";

const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

export async function enqueueWorkerJob(jobType: string, payload: Record<string, unknown>) {
  const db = requireDb();
  const [job] = await db
    .insert(workerJobs)
    .values({ jobType, payload, maxAttempts: MAX_ATTEMPTS })
    .returning();
  return job;
}

export async function claimNextWorkerJob() {
  const db = requireDb();
  const [next] = await db
    .select()
    .from(workerJobs)
    .where(and(eq(workerJobs.status, "queued"), lt(workerJobs.attempts, MAX_ATTEMPTS)))
    .limit(1);

  if (!next) return null;

  const [claimed] = await db
    .update(workerJobs)
    .set({
      status: "running",
      startedAt: new Date(),
      attempts: next.attempts + 1,
      progress: 10,
    })
    .where(and(eq(workerJobs.id, next.id), eq(workerJobs.status, "queued")))
    .returning();

  return claimed ?? null;
}

export async function updateJobProgress(jobId: string, progress: number) {
  const db = requireDb();
  await db.update(workerJobs).set({ progress }).where(eq(workerJobs.id, jobId));
}

export async function completeWorkerJob(jobId: string) {
  const db = requireDb();
  await db
    .update(workerJobs)
    .set({ status: "completed", progress: 100, finishedAt: new Date() })
    .where(eq(workerJobs.id, jobId));
}

export async function failWorkerJob(jobId: string, error: string, attempts: number, maxAttempts: number) {
  const db = requireDb();
  const shouldRetry = attempts < maxAttempts;
  await db
    .update(workerJobs)
    .set({
      status: shouldRetry ? "queued" : "failed",
      error,
      finishedAt: shouldRetry ? null : new Date(),
      startedAt: null,
      progress: 0,
    })
    .where(eq(workerJobs.id, jobId));
  return shouldRetry;
}

export function isJobTimedOut(startedAt: Date | null): boolean {
  if (!startedAt) return false;
  return Date.now() - startedAt.getTime() > JOB_TIMEOUT_MS;
}
