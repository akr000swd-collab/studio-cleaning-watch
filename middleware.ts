import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled } from "@/lib/auth";

export function middleware(req: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/alarm.mp3") ||
    pathname.startsWith("/favicon");

  if (isPublic) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookie === process.env.APP_PASSWORD) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
