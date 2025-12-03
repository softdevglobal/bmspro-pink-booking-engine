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
      .collection("branches")
      .where("ownerUid", "==", ownerUid)
      .get();

    const branches = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ branches });
  } catch (error: any) {
    console.error("Error fetching branches:", error);
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
