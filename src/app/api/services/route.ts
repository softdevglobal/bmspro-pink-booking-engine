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
    const snapshot = await db
      .collection("services")
      .where("ownerUid", "==", ownerUid)
      .get();

    const services = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ services });
  } catch (e: any) {
    console.error("Error fetching services:", e);
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal error" 
      : (e?.message || "Internal error");
    return NextResponse.json(
      { error: errorMessage, details: e?.stack },
      { status: 500 }
    );
  }
}

