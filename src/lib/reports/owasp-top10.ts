export const OWASP_TOP10_2021 = [
  {
    id: "A01" as const,
    code: "A01:2021",
    name: "Broken Access Control",
    description: "Missing authorization checks, IDOR, privilege escalation, path traversal.",
  },
  {
    id: "A02" as const,
    code: "A02:2021",
    name: "Cryptographic Failures",
    description: "Hardcoded secrets, weak TLS, exposed credentials, missing encryption.",
  },
  {
    id: "A03" as const,
    code: "A03:2021",
    name: "Injection",
    description: "SQL/NoSQL/command injection, XSS, unsafe deserialization.",
  },
  {
    id: "A04" as const,
    code: "A04:2021",
    name: "Insecure Design",
    description: "Missing threat modeling, unsafe workflows, business-logic flaws.",
  },
  {
    id: "A05" as const,
    code: "A05:2021",
    name: "Security Misconfiguration",
    description: "Debug modes, default creds, open CORS, missing security headers.",
  },
  {
    id: "A06" as const,
    code: "A06:2021",
    name: "Vulnerable and Outdated Components",
    description: "Known CVEs, unpinned deps, outdated frameworks.",
  },
  {
    id: "A07" as const,
    code: "A07:2021",
    name: "Identification and Authentication Failures",
    description: "Weak sessions, missing MFA, credential stuffing, broken auth flows.",
  },
  {
    id: "A08" as const,
    code: "A08:2021",
    name: "Software and Data Integrity Failures",
    description: "Unsigned updates, unsafe CI/CD, tampered dependencies.",
  },
  {
    id: "A09" as const,
    code: "A09:2021",
    name: "Security Logging and Monitoring Failures",
    description: "Missing audit logs, no alerting on suspicious activity.",
  },
  {
    id: "A10" as const,
    code: "A10:2021",
    name: "Server-Side Request Forgery (SSRF)",
    description: "Unsafe outbound requests, open redirects fetching internal URLs.",
  },
] as const;

export type OwaspCategoryId = (typeof OWASP_TOP10_2021)[number]["id"] | "none";

export type OwaspMappedFinding = {
  findingId: string;
  title: string;
  severity: string;
  filePath?: string;
  owaspId: OwaspCategoryId;
  owaspCode: string;
  owaspName: string;
};

export type OwaspCategorySummary = {
  id: OwaspCategoryId;
  code: string;
  name: string;
  description: string;
  count: number;
  findings: OwaspMappedFinding[];
};

export type OwaspTop10Summary = {
  categories: OwaspCategorySummary[];
  unmappedCount: number;
  unmappedFindings: OwaspMappedFinding[];
  totalMapped: number;
};

type FindingLike = {
  id: string;
  title: string;
  description: string;
  severity: string;
  category?: string;
  filePath?: string;
};

const OWASP_BY_ID = Object.fromEntries(OWASP_TOP10_2021.map((c) => [c.id, c])) as Record<
  (typeof OWASP_TOP10_2021)[number]["id"],
  (typeof OWASP_TOP10_2021)[number]
>;

type Rule = {
  id: (typeof OWASP_TOP10_2021)[number]["id"];
  patterns: string[];
};

const RULES: Rule[] = [
  { id: "A10", patterns: ["ssrf", "server-side request forgery", "open redirect", "fetch user url"] },
  { id: "A03", patterns: ["sql injection", "nosql injection", "command injection", "xss", "cross-site scripting", "inject", "deserializ"] },
  { id: "A02", patterns: ["hardcoded secret", "api key", "private key", "credential", "plaintext password", "secret leak", "encryption", "tls", "ssl", "crypto"] },
  { id: "A07", patterns: ["authentication", "auth failure", "session", "jwt", "oauth", "login", "password reset", "mfa", "2fa", "brute force"] },
  { id: "A01", patterns: ["access control", "authorization", "permission", "idor", "privilege", "path traversal", "bypass auth", "forbidden", "unauthorized route"] },
  { id: "A06", patterns: ["cve-", "vulnerable component", "npm audit", "pip-audit", "outdated depend", "dependency vulner", "known vulner"] },
  { id: "A05", patterns: ["misconfig", "cors", "security header", "debug mode", "default cred", "exposed route", "public bucket", "env var", "error stack"] },
  { id: "A09", patterns: ["logging", "monitoring", "audit log", "alerting", "no log", "missing log"] },
  { id: "A08", patterns: ["supply chain", "integrity", "unsigned", "tamper", "ci/cd", "webhook verify"] },
  { id: "A04", patterns: ["insecure design", "threat model", "business logic", "rate limit", "abuse case"] },
];

function parseExplicitOwasp(text: string): (typeof OWASP_TOP10_2021)[number]["id"] | null {
  const match = text.match(/\bA(10|[0-9])(?::2021)?\b/i);
  if (!match) return null;
  const num = match[1].padStart(2, "0");
  const id = `A${num}` as (typeof OWASP_TOP10_2021)[number]["id"];
  if (id in OWASP_BY_ID) return id;
  return null;
}

export function mapFindingToOwasp(finding: FindingLike): OwaspMappedFinding {
  const text = `${finding.title} ${finding.description} ${finding.category ?? ""}`.toLowerCase();

  const explicit = parseExplicitOwasp(text);
  if (explicit) {
    const cat = OWASP_BY_ID[explicit];
    return {
      findingId: finding.id,
      title: finding.title,
      severity: finding.severity,
      filePath: finding.filePath,
      owaspId: cat.id,
      owaspCode: cat.code,
      owaspName: cat.name,
    };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((p) => text.includes(p))) {
      const cat = OWASP_BY_ID[rule.id];
      return {
        findingId: finding.id,
        title: finding.title,
        severity: finding.severity,
        filePath: finding.filePath,
        owaspId: cat.id,
        owaspCode: cat.code,
        owaspName: cat.name,
      };
    }
  }

  if (finding.category === "injection") {
    const cat = OWASP_BY_ID.A03;
    return { findingId: finding.id, title: finding.title, severity: finding.severity, filePath: finding.filePath, owaspId: cat.id, owaspCode: cat.code, owaspName: cat.name };
  }
  if (finding.category === "auth" || finding.category === "security") {
    const cat = OWASP_BY_ID.A07;
    return { findingId: finding.id, title: finding.title, severity: finding.severity, filePath: finding.filePath, owaspId: cat.id, owaspCode: cat.code, owaspName: cat.name };
  }
  if (finding.category === "dependencies") {
    const cat = OWASP_BY_ID.A06;
    return { findingId: finding.id, title: finding.title, severity: finding.severity, filePath: finding.filePath, owaspId: cat.id, owaspCode: cat.code, owaspName: cat.name };
  }

  return {
    findingId: finding.id,
    title: finding.title,
    severity: finding.severity,
    filePath: finding.filePath,
    owaspId: "none",
    owaspCode: "—",
    owaspName: "Unmapped",
  };
}

export function buildOwaspTop10Summary(findings: FindingLike[]): OwaspTop10Summary {
  const mapped = findings.map(mapFindingToOwasp);
  const unmappedFindings = mapped.filter((f) => f.owaspId === "none");
  const categories = OWASP_TOP10_2021.map((cat) => {
    const catFindings = mapped.filter((f) => f.owaspId === cat.id);
    return {
      id: cat.id,
      code: cat.code,
      name: cat.name,
      description: cat.description,
      count: catFindings.length,
      findings: catFindings,
    };
  }).filter((c) => c.count > 0);

  return {
    categories,
    unmappedCount: unmappedFindings.length,
    unmappedFindings,
    totalMapped: mapped.length - unmappedFindings.length,
  };
}

export function owaspTop10ToMarkdown(summary: OwaspTop10Summary): string {
  if (!summary.categories.length && !summary.unmappedCount) {
    return "## OWASP Top 10:2021 mapping\n\nNo security findings to map.\n";
  }

  const lines = [
    "## OWASP Top 10:2021 mapping",
    "",
    "Heuristic mapping from Boswell findings — not a formal compliance assessment.",
    "",
  ];

  for (const cat of summary.categories) {
    lines.push(`### ${cat.code} — ${cat.name} (${cat.count})`);
    lines.push(cat.description);
    for (const f of cat.findings) {
      lines.push(`- [${f.severity}] ${f.title}${f.filePath ? ` — \`${f.filePath}\`` : ""}`);
    }
    lines.push("");
  }

  if (summary.unmappedCount) {
    lines.push(`### Unmapped (${summary.unmappedCount})`);
    lines.push("Findings that did not match an OWASP category keyword.");
    for (const f of summary.unmappedFindings.slice(0, 10)) {
      lines.push(`- [${f.severity}] ${f.title}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
