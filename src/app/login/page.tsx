import { signIn } from "@/lib/auth";
import { signInOwner } from "@/lib/auth/owner-bootstrap";
import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  const hasBootstrap = Boolean(process.env.GITHUB_BOOTSTRAP_TOKEN);
  const hasOAuth = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <Card className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-white">Sign in to Boswell Cloud</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Connect GitHub to import repositories and run cloud audits.
        </p>

        {hasBootstrap ? (
          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signInOwner();
            }}
          >
            <Button type="submit" className="w-full">
              Continue as owner
            </Button>
          </form>
        ) : null}

        {hasOAuth ? (
          <form
            className={hasBootstrap ? "mt-3" : "mt-8"}
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" className="w-full" variant={hasBootstrap ? "secondary" : "primary"}>
              Continue with GitHub
            </Button>
          </form>
        ) : null}

        {!hasBootstrap && !hasOAuth ? (
          <p className="mt-8 text-sm text-red-400">Sign-in is not configured yet.</p>
        ) : null}
      </Card>
    </div>
  );
}
