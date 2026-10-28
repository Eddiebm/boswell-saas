import type { Metadata } from "next";
import { contactLine, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of service — Boswell" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>By using Boswell you agree to these terms.</p>

      <h2>What Boswell does</h2>
      <p>
        Boswell audits repositories you connect, reports findings, and can open pull requests you request. It never pushes to
        your default branch or merges anything: every change is a pull request for you to review. Findings are automated
        analysis — they can miss problems and can be wrong — and are not a guarantee that your application is secure.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only connect repositories you have the right to share with Boswell and its processors.</li>
        <li>
          Only point live verification at systems you own or are authorised to test, using test accounts you control. Boswell
          sends real requests to the URL you provide.
        </li>
        <li>Review every pull request and finding before acting on it, and keep your own backups.</li>
        <li>Don&apos;t use Boswell to attack, overload or probe systems you don&apos;t own.</li>
      </ul>

      <h2>Plans and billing</h2>
      <p>
        Paid plans are billed through Stripe and renew until cancelled. You can cancel at any time; your plan stays active until
        the end of the period you&apos;ve paid for.
      </p>

      <h2>Availability and liability</h2>
      <p>
        Boswell is provided as is. To the extent the law allows, we aren&apos;t liable for indirect or consequential losses, and
        our total liability is limited to what you paid for Boswell in the 12 months before the claim.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop at any time and ask for your data to be deleted (see the privacy policy). We may suspend accounts that break
        these terms.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {contactLine()}.</p>
    </LegalPage>
  );
}
