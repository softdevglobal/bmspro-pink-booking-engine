import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";
import { validateOwnerUid } from "@/lib/ownerValidation";

export const runtime = "nodejs";

function toMillis(v: unknown): number | null {
  if (v == null) return null;
  const td = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof td.toMillis === "function") {
    try {
      const n = td.toMillis();
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    } catch {
      /* fall through */
    }
  }
  if (typeof td.toDate === "function") {
    try {
      const d = td.toDate();
      const t = d.getTime();
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * GET /api/approved-leaves?ownerUid=
 * Returns approved leave rows for public booking UI (slot + staff filtering).
 */
export async function GET(req: NextRequest) {
  try {
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.general);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimitResult.retryAfter) },
        }
      );
    }

    const { searchParams } = new URL(req.url);
    const ownerUid = searchParams.get("ownerUid");
    if (!ownerUid) {
      return NextResponse.json({ error: "ownerUid is required" }, { status: 400 });
    }

    const ownerValidation = await validateOwnerUid(ownerUid);
    if (!ownerValidation.valid) {
      return NextResponse.json(
        { error: ownerValidation.error || "Salon not found" },
        { status: 404 }
      );
    }

    const db = adminDb();
    const snap = await db.collection("leaveRequests").where("ownerUid", "==", ownerUid).get();

    const leaves = snap.docs
      .map((doc) => {
        const x = doc.data() as Record<string, unknown>;
        const status = String(x.status ?? "").trim().toLowerCase();
        if (status !== "approved") return null;
        const fromMillis = toMillis(x.fromDate);
        const toMillisVal = toMillis(x.toDate);
        if (fromMillis == null || toMillisVal == null) return null;
        return {
          requesterUid: String(x.requesterUid ?? ""),
          status: "approved",
          fromMillis,
          toMillis: toMillisVal,
          isFullDay: x.isFullDay !== false,
          startTime: x.startTime != null ? String(x.startTime) : null,
          endTime: x.endTime != null ? String(x.endTime) : null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ leaves });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("approved-leaves GET error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
