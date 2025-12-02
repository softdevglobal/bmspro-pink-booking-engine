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
      .collection("users")
      .where("ownerUid", "==", ownerUid)
      .where("role", "in", ["salon_staff", "salon_branch_admin"])
      .get();

    const staff = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ staff });
  } catch (e: any) {
    console.error("Error fetching staff:", e);
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal error" 
      : (e?.message || "Internal error");
    return NextResponse.json(
      { error: errorMessage, details: e?.stack },
      { status: 500 }
    );
  }
}

