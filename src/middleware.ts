import { isDemoMode } from "@/lib/demo/mode";
import { isAdminEmail } from "@/lib/admin";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default async function middleware(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.next();
  }

  const { auth } = await import("@/lib/auth");
  return auth((req) => {
    if (!req.auth && req.nextUrl.pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // /dashboard/admin exposes infra status (env checks, worker health,
    // ADMIN_ALERT_EMAIL, ...) — being signed in is not enough, the user must
    // also be the configured owner/admin.
    if (req.auth && req.nextUrl.pathname.startsWith("/dashboard/admin")) {
      if (!isAdminEmail(req.auth.user?.email)) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
  })(request, { params: Promise.resolve({}) });
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
