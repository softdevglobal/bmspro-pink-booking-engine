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
    
    // Provide helpful error messages even in production
    let errorMessage = "Internal error";
    if (e?.message) {
      if (e.message.includes("credentials") || e.message.includes("Firebase Admin")) {
        errorMessage = "Server configuration error. Please contact support.";
      } else if (e.message.includes("permission") || e.message.includes("PERMISSION_DENIED")) {
        errorMessage = "Database permission error. Please contact support.";
      } else if (process.env.NODE_ENV !== "production") {
        errorMessage = e.message;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        helpText: "If this error persists, please ensure Firebase Admin credentials are configured on the server."
      },
      { status: 500 }
    );
  }
}

