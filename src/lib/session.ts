import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_USER_ID } from "@/lib/demo/data";
import { redirect } from "next/navigation";

export async function requireUserId(): Promise<string> {
  if (isDemoMode()) return DEMO_USER_ID;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function getOptionalUserId(): Promise<string | null> {
  if (isDemoMode()) return DEMO_USER_ID;
  const session = await auth();
  return session?.user?.id ?? null;
}
