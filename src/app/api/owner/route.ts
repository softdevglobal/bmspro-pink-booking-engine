import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const ownerUid = searchParams.get("ownerUid");

    if (!ownerUid) {
      return NextResponse.json({ error: "ownerUid is required" }, { status: 400 });
    }

    const db = adminDb();
    
    // Try to get owner document directly by UID
    const ownerDoc = await db.doc(`users/${ownerUid}`).get();
    
    if (!ownerDoc.exists) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const ownerData = ownerDoc.data();
    
    // Get salon name from owner's displayName, name, or businessName field
    const salonName = ownerData?.businessName || ownerData?.displayName || ownerData?.name || "Salon";

    return NextResponse.json({ 
      owner: {
        uid: ownerUid,
        name: ownerData?.displayName || ownerData?.name || "",
        businessName: ownerData?.businessName || salonName,
        salonName: salonName,
        email: ownerData?.email || null,
      }
    });
  } catch (e: any) {
    console.error("Error fetching owner:", e);
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal error" 
      : (e?.message || "Internal error");
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

