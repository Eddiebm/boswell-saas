import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const auditStatusEnum = pgEnum("audit_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const findingSeverityEnum = pgEnum("finding_severity", [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "open",
  "fixed",
  "ignored",
  "recurring",
]);

export const planEnum = pgEnum("plan", ["free", "pro", "team", "business"]);

export const findingClassificationEnum = pgEnum("finding_classification", [
  "good",
  "bad",
  "dangerous",
  "evil",
]);

export const autoFixLevelEnum = pgEnum("auto_fix_level", ["green", "yellow", "red"]);

export const workerJobStatusEnum = pgEnum("worker_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const fixQueueStatusEnum = pgEnum("fix_queue_status", [
  "pending",
  "in_progress",
  "completed",
  "skipped",
]);

export const prStatusEnum = pgEnum("pr_status", [
  "draft",
  "open",
  "merged",
  "closed",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  githubLogin: text("github_login"),
  plan: planEnum("plan").default("free").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  auditsUsedThisMonth: integer("audits_used_this_month").default(0).notNull(),
  auditMonthKey: text("audit_month_key"),
  primaryRepositoryId: uuid("primary_repository_id"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const repositoryInstallations = pgTable("repository_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  githubInstallationId: integer("github_installation_id"),
  accountLogin: text("account_login").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const repositories = pgTable("repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  githubId: integer("github_id").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  cloneUrl: text("clone_url").notNull(),
  defaultBranch: text("default_branch").default("main").notNull(),
  isPrivate: boolean("is_private").default(false).notNull(),
  description: text("description"),
  healthScore: integer("health_score"),
  slopPercent: real("slop_percent"),
  lastAuditAt: timestamp("last_audit_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const auditRuns = pgTable("audit_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  status: auditStatusEnum("status").default("queued").notNull(),
  auditMode: text("audit_mode").default("standard").notNull(),
  commitSha: text("commit_sha"),
  stack: jsonb("stack").$type<string[]>().default([]),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  summary: text("summary"),
  deployVerdict: text("deploy_verdict"),
  topRisk: text("top_risk"),
  briefingJson: jsonb("briefing_json"),
  slopJson: jsonb("slop_json"),
  scoresJson: jsonb("scores_json"),
  error: text("error"),
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  auditRunId: uuid("audit_run_id")
    .notNull()
    .references(() => auditRuns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: findingSeverityEnum("severity").notNull(),
  category: text("category").notNull(),
  filePath: text("file_path"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  evidence: jsonb("evidence").$type<string[]>().default([]),
  recommendation: text("recommendation"),
  simpleExplanation: text("simple_explanation"),
  classification: findingClassificationEnum("classification").default("bad"),
  fixSteps: text("fix_steps"),
  autoFixLevel: autoFixLevelEnum("auto_fix_level").default("red"),
  coaching: jsonb("coaching"),
  confidence: real("confidence").default(0.8),
  status: findingStatusEnum("status").default("open").notNull(),
  autoFixable: boolean("auto_fixable").default(false).notNull(),
  firstSeenAt: timestamp("first_seen_at", { mode: "date" }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { mode: "date" }).defaultNow().notNull(),
  fixedAt: timestamp("fixed_at", { mode: "date" }),
  resolved: boolean("resolved").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditRunId: uuid("audit_run_id")
    .notNull()
    .references(() => auditRuns.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  markdown: text("markdown").notNull(),
  structured: jsonb("structured"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/** @deprecated use reports table */
export const auditDocuments = pgTable("audit_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditRunId: uuid("audit_run_id")
    .notNull()
    .references(() => auditRuns.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const repoScores = pgTable("repo_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  overall: integer("overall").notNull(),
  security: integer("security").notNull(),
  architecture: integer("architecture").notNull(),
  maintainability: integer("maintainability").notNull(),
  dependencies: integer("dependencies").notNull(),
  testing: integer("testing").notNull(),
  documentation: integer("documentation").notNull(),
  complexity: integer("complexity").notNull(),
  aiSlop: integer("ai_slop").notNull(),
  releaseRisk: integer("release_risk").notNull(),
  details: jsonb("details"),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const scoreSnapshots = pgTable("score_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  auditRunId: uuid("audit_run_id").references(() => auditRuns.id, {
    onDelete: "set null",
  }),
  overall: integer("overall").notNull(),
  security: integer("security").notNull(),
  architecture: integer("architecture").notNull(),
  maintainability: integer("maintainability").notNull(),
  dependencies: integer("dependencies").notNull(),
  testing: integer("testing").notNull(),
  documentation: integer("documentation").notNull(),
  complexity: integer("complexity").notNull(),
  aiSlop: integer("ai_slop").notNull(),
  releaseRisk: integer("release_risk").notNull(),
  snapshotAt: timestamp("snapshot_at", { mode: "date" }).defaultNow().notNull(),
});

export const memoryEvents = pgTable("memory_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at", { mode: "date" }).defaultNow().notNull(),
});

export const fixQueueItems = pgTable("fix_queue_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  findingId: uuid("finding_id").references(() => findings.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  severity: findingSeverityEnum("severity").notNull(),
  effort: text("effort").notNull(),
  impact: text("impact").notNull(),
  files: jsonb("files").$type<string[]>().default([]),
  whyItMatters: text("why_it_matters").notNull(),
  suggestedFix: text("suggested_fix").notNull(),
  canAutoPr: boolean("can_auto_pr").default(false).notNull(),
  priorityScore: integer("priority_score").notNull(),
  status: fixQueueStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const pullRequests = pgTable("pull_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  findingId: uuid("finding_id").references(() => findings.id, {
    onDelete: "set null",
  }),
  fixQueueItemId: uuid("fix_queue_item_id").references(() => fixQueueItems.id, {
    onDelete: "set null",
  }),
  branch: text("branch").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  riskLevel: text("risk_level").notNull(),
  rollbackNote: text("rollback_note"),
  githubPrNumber: integer("github_pr_number"),
  githubPrUrl: text("github_pr_url"),
  status: prStatusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: planEnum("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").default(false).notNull(),
  href: text("href"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const workerJobs = pgTable("worker_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobType: text("job_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: workerJobStatusEnum("status").default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  progress: integer("progress").default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const repoQuestions = pgTable("repo_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const repoAnswers = pgTable("repo_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => repoQuestions.id, { onDelete: "cascade" }),
  answer: text("answer").notNull(),
  evidence: jsonb("evidence").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const architectureDecisions = pgTable("architecture_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  rationale: text("rationale"),
  decidedAt: timestamp("decided_at", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const dependencyEvents = pgTable("dependency_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(),
  fromVersion: text("from_version"),
  toVersion: text("to_version"),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { mode: "date" }).defaultNow().notNull(),
});

export const safeFixPolicies = pgTable("safe_fix_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  level: autoFixLevelEnum("level").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
