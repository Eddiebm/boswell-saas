import { signIn } from "@/lib/auth";
import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <Card className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-white">Sign in to Boswell Cloud</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Connect GitHub to import repositories and run cloud audits.
        </p>
        <form
          className="mt-8 space-y-3"
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="w-full">
            Continue with GitHub
          </Button>
        </form>
        {process.env.GITHUB_BOOTSTRAP_TOKEN ? (
          <p className="mt-4 text-xs text-zinc-500">
            Owner setup: visit{" "}
            <code className="text-zinc-400">/api/setup/owner</code> with{" "}
            <code className="text-zinc-400">x-worker-secret</code> header.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
