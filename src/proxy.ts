import { NextResponse, type NextRequest } from "next/server";
import { betterFetch } from "@better-fetch/fetch";
import type { Session } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { data: session } = await betterFetch<Session>(
    "/api/auth/get-session",
    {
      // Always loopback, never `request.nextUrl.origin`: this fetch is a
      // same-container call to this same Next.js process, not a public
      // request. Behind a reverse proxy (Coolify/Traefik) that terminates
      // TLS at the edge, `nextUrl.origin` reflects the public https://
      // origin, but the process itself only ever speaks plain HTTP on
      // PORT — dialing that origin makes the fetch client attempt TLS
      // against a plaintext server (ERR_SSL_WRONG_VERSION_NUMBER).
      baseURL: `http://127.0.0.1:${process.env.PORT || 3000}`,
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    }
  );

  const { pathname } = request.nextUrl;

  if (!session && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/register",
  ],
};