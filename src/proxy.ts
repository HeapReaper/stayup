import { NextResponse, type NextRequest } from "next/server";
import { betterFetch } from "@better-fetch/fetch";
import type { Session } from "@/lib/auth";

function loopbackBase() {
  // Always loopback, never `request.nextUrl.origin`: these are same-container
  // calls to this same Next.js process, not public requests. Behind a
  // reverse proxy (Coolify/Traefik) that terminates TLS at the edge,
  // `nextUrl.origin` reflects the public https:// origin, but the process
  // itself only ever speaks plain HTTP on PORT — dialing that origin makes
  // the fetch client attempt TLS against a plaintext server
  // (ERR_SSL_WRONG_VERSION_NUMBER).
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/** Hostname (no port) this app itself is configured to be reachable at. */
function appHostname(): string | null {
  try {
    return new URL(process.env.BETTER_AUTH_URL || "").hostname || null;
  } catch {
    return null;
  }
}

/** Resolves a StatusPage.customDomain to its slug via the loopback API route — Prisma can't run in this runtime, same reasoning as the session check below. */
async function resolveStatusPageSlug(hostname: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${loopbackBase()}/api/public/status-domain?host=${encodeURIComponent(hostname)}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { slug: string | null };
    return data.slug;
  } catch {
    return null;
  }
}

/**
 * Paths that belong to the app itself and never to a status page, however the
 * request arrived. Everything under /api is already excluded above; this is
 * the page half.
 */
const AUTH_PATHS = ["/login", "/register", "/logout"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";

  // Custom-domain rewrite: a published status page's own hostname (e.g.
  // "status.acme.com", set on the Status Pages editor) transparently shows
  // /status/[slug] instead of 404ing — the URL bar keeps showing the custom
  // domain since this is a rewrite, not a redirect. Skipped for requests
  // already on this app's own domain (almost all traffic — the lookup below
  // only actually runs for genuine custom-domain requests) and for
  // _next/api, which the rewrite never targets anyway.
  if (
    hostname &&
    hostname !== appHostname() &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/_next")
  ) {
    // Sign-in never happens on a custom domain. A private status page there
    // used to redirect to /login on its own hostname, where this same rewrite
    // turned it into /status/<slug>/login and 404'd — a loop with no way out.
    //
    // Send it to the app's own origin instead, which is where the session
    // cookie lives and the only place better-auth (and any OIDC redirect URI
    // registered with an identity provider) is configured for.
    if (AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      const appOrigin = process.env.BETTER_AUTH_URL;
      if (appOrigin) {
        return NextResponse.redirect(new URL(pathname + request.nextUrl.search, appOrigin));
      }
    }

    const slug = await resolveStatusPageSlug(hostname);
    if (slug) {
      // The rest of the path is carried across, so the page's sub-routes —
      // /badge/<id>.svg, /feed.xml, /atom.xml — work on the custom domain too.
      // Without this every path on that hostname would collapse onto the page
      // itself, and a badge embedded from status.acme.com would render HTML.
      const suffix = pathname === "/" ? "" : pathname;
      return NextResponse.rewrite(new URL(`/status/${slug}${suffix}`, request.url));
    }
  }

  if (pathname.startsWith("/dashboard") || pathname === "/login" || pathname === "/register") {
    const { data: session } = await betterFetch<Session>("/api/auth/get-session", {
      baseURL: loopbackBase(),
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    });

    if (!session && pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (session && (pathname === "/login" || pathname === "/register")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
