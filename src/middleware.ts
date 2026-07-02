import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((request) => {
  if (!request.auth) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
