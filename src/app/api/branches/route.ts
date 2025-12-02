import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    console.log("Branches API called");
    const searchParams = req.nextUrl.searchParams;
    const ownerUid = searchParams.get("ownerUid");
    console.log("Owner UID:", ownerUid);

    if (!ownerUid) {
      return NextResponse.json({ error: "ownerUid is required" }, { status: 400 });
    }

    console.log("Initializing Firebase Admin...");
    const db = adminDb();
    console.log("Firebase Admin initialized, querying branches...");
    
    const snapshot = await db
      .collection("branches")
      .where("ownerUid", "==", ownerUid)
      .get();

    console.log(`Found ${snapshot.size} branches`);
    const branches = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ branches });
  } catch (e: any) {
    console.error("Error fetching branches:", e);
    console.error("Error stack:", e?.stack);
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal error" 
      : (e?.message || "Internal error");
    return NextResponse.json(
      { error: errorMessage, details: process.env.NODE_ENV !== "production" ? e?.stack : undefined },
      { status: 500 }
    );
  }
}

