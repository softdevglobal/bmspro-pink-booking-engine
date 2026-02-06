import { NextRequest, NextResponse } from "next/server";
import { lookupSlug } from "@/lib/slugLookup";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";

export const runtime = "nodejs";

/**
 * GET /api/resolve-slug?slug=abc-salon
 *
 * Resolves a salon slug to an ownerUid.
 * Used by the [slug] dynamic route for client-side fallback.
 */
export async function GET(req: NextRequest) {
  try {
    // Security: Rate limiting
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.general);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter),
          },
        }
      );
    }

    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const result = await lookupSlug(slug);

    if (!result.found || !result.ownerUid) {
      return NextResponse.json(
        { error: "Salon not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ownerUid: result.ownerUid,
      salonName: result.salonName,
      salonData: result.salonData,
    });
  } catch (error: any) {
    console.error("Error resolving slug:", error);
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
