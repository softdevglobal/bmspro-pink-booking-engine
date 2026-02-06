import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware handles:
 * 1. Subdomain-based routing  — abc-salon.pink.bmspros.com.au → /abc-salon (optional, if subdomains are used)
 * 2. Security headers
 * 3. RSC endpoint protection
 */

// The root booking domain (without subdomain).
// Configure via env or fall back to the production value.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "book.bmspros.com.au";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname = request.headers.get("host") || "";

  // ── 1. Subdomain rewrite ────────────────────────────────────────────────
  // If the request arrives on a subdomain (e.g., abc-salon.book.bmspros.com.au),
  // rewrite it internally to /{slug} so the [slug] dynamic route handles it.
  // This keeps the browser URL unchanged (no visible redirect).
  if (hostname && ROOT_DOMAIN) {
    const currentHost = hostname.split(":")[0]; // strip port for local dev

    // Check if this is a subdomain of our root domain
    if (
      currentHost !== ROOT_DOMAIN &&
      currentHost.endsWith(`.${ROOT_DOMAIN}`)
    ) {
      const subdomain = currentHost.replace(`.${ROOT_DOMAIN}`, "");

      // Only rewrite if the subdomain looks like a valid slug
      // (not "www", "api", etc.)
      const reservedSubdomains = ["www", "api", "admin", "beta", "staging"];
      if (subdomain && !reservedSubdomains.includes(subdomain)) {
        // Only rewrite root path and paths that aren't API/static
        if (
          url.pathname === "/" ||
          (!url.pathname.startsWith("/api") &&
            !url.pathname.startsWith("/_next") &&
            !url.pathname.startsWith("/book"))
        ) {
          // Rewrite: abc-salon.book.bmspros.com.au/ → /abc-salon
          // Rewrite: abc-salon.book.bmspros.com.au/anything → /abc-salon (keep on booking)
          url.pathname = `/${subdomain}${url.pathname === "/" ? "" : url.pathname}`;
          const response = NextResponse.rewrite(url);
          addSecurityHeaders(response);
          return response;
        }
      }
    }
  }

  // ── 2. Security headers + RSC protection ─────────────────────────────────
  const response = NextResponse.next();
  addSecurityHeaders(response);

  // Protect RSC endpoints from DoS attacks (CVE-2025-55184)
  if (
    request.nextUrl.pathname.startsWith("/_next/rsc") ||
    request.nextUrl.pathname.startsWith("/_next/server-actions")
  ) {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      return new NextResponse("Request too large", { status: 413 });
    }
  }

  return response;
}

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image  (image optimization files)
     * - favicon.ico  (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
