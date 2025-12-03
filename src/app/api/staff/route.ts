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
    const snapshot = await db
      .collection("salonStaff")
      .where("ownerUid", "==", ownerUid)
      .get();

    const staff = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ staff });
  } catch (error: any) {
    console.error("Error fetching staff:", error);
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
