import type { Metadata } from "next";
import { contactLine, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy policy — Boswell" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Boswell audits the code of repositories you connect and tells you what to fix before and after launch. This page says
        what data that involves, who processes it, and how to have it deleted.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your GitHub account:</strong> name, email address, avatar, and a GitHub access token. The token lets Boswell
          list your repositories, clone the ones you choose to audit, and open pull requests you ask for. We never push to
          your default branch or merge anything.
        </li>
        <li>
          <strong>Repository code:</strong> each audit clones the repository into a temporary workspace that is deleted when the
          audit finishes. We keep the results — findings, file paths and line numbers, short excerpts, scores and reports — not
          a copy of your code.
        </li>
        <li>
          <strong>Live verification details</strong> (only if you set it up): your staging URL and the two test accounts you
          provide. Test account passwords are stored encrypted and used only to run the checks you start.
        </li>
        <li>
          <strong>Billing:</strong> handled by Stripe. We store your plan and Stripe customer ID, never your card details.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>OpenRouter</strong> and the AI model providers it routes to, which receive parts of your code during an audit
          to produce the analysis.
        </li>
        <li>
          <strong>GitHub</strong> (sign-in, repository access, and GitHub Actions, where audits run).
        </li>
        <li>
          <strong>The npm registry</strong>, which receives your dependency list (package names and versions) when we check
          for vulnerable packages. Your code is not sent.
        </li>
        <li>
          <strong>Vercel</strong> (hosting), <strong>Neon</strong> (database), <strong>Stripe</strong> (payments),{" "}
          <strong>Resend</strong> (email), and <strong>Sentry</strong> (error reports — the error and stack trace only, no
          request contents, cookies or personal data).
        </li>
      </ul>
      <p>We don&apos;t sell your data or use it for advertising.</p>

      <h2>How long we keep it</h2>
      <p>
        Audit results are kept so Boswell can track your repository over time. When you ask us to delete your account, we delete
        your account, tokens, repositories, audits, findings and verification settings. Revoking Boswell&apos;s access in your
        GitHub settings stops all further access immediately.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, a correction, or deletion at any time by {contactLine()}. We&apos;ll respond within 30
        days.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, we&apos;ll update the date above and tell signed-in users.</p>
    </LegalPage>
  );
}
