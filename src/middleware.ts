import { isDemoMode } from "@/lib/demo/mode";
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
  })(request, { params: Promise.resolve({}) });
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
