import { NextRequest, NextResponse } from "next/server";

// Security middleware to protect against RSC vulnerabilities
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Protect RSC endpoints from DoS attacks (CVE-2025-55184)
  if (request.nextUrl.pathname.startsWith("/_next/rsc") || 
      request.nextUrl.pathname.startsWith("/_next/server-actions")) {
    // Limit request size for RSC endpoints
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return new NextResponse("Request too large", { status: 413 });
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
