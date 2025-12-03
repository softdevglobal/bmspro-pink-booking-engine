import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ownerUid = searchParams.get("ownerUid");

    if (!ownerUid) {
      return NextResponse.json({ error: "ownerUid is required" }, { status: 400 });
    }

    const db = adminDb();
    const doc = await db.doc(`users/${ownerUid}`).get();
    
    if (!doc.exists) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const data = doc.data();
    // Try multiple fields to get the salon/business name
    const salonName = data?.salonName || data?.name || data?.businessName || data?.displayName || "Salon";

    return NextResponse.json({ 
      salonName,
    });
  } catch (error: any) {
    console.error("Error fetching owner:", error);
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
