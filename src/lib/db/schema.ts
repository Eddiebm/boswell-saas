import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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

export const planEnum = pgEnum("plan", ["free", "pro", "team"]);

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
  commitSha: text("commit_sha"),
  stack: jsonb("stack").$type<string[]>().default([]),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  summary: text("summary"),
  deployVerdict: text("deploy_verdict"),
  topRisk: text("top_risk"),
  error: text("error"),
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditRunId: uuid("audit_run_id")
    .notNull()
    .references(() => auditRuns.id, { onDelete: "cascade" }),
  severity: findingSeverityEnum("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  filePath: text("file_path"),
  lineNumber: integer("line_number"),
  recommendation: text("recommendation"),
  resolved: boolean("resolved").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const auditDocuments = pgTable("audit_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditRunId: uuid("audit_run_id")
    .notNull()
    .references(() => auditRuns.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
