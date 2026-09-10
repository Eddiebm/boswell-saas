import { signIn } from "@/lib/auth";
import { Button, Card } from "@/components/ui";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const hasOAuth = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <Card className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-white">Sign in to Boswell Cloud</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Connect GitHub to import repositories and run cloud audits.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {hasOAuth ? (
          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" className="w-full">
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
