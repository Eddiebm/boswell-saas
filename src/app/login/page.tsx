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
      </Card>
    </div>
  );
}
