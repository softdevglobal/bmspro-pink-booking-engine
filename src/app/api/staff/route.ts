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
    
    // Query users collection for staff members belonging to this owner
    const snapshot = await db
      .collection("users")
      .where("ownerUid", "==", ownerUid)
      .get();

    // Filter for staff roles only (not customers)
    const staff = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Use uid or id for matching with staffIds in services
          uid: data.uid || doc.id,
        } as any;
      })
      .filter((user: any) => {
        const role = (user.role || "").toString().toLowerCase();
        // Include salon staff and branch admins
        return role === "salon_staff" || role === "salon_branch_admin";
      });

    return NextResponse.json({ staff });
  } catch (error: any) {
    console.error("Error fetching staff:", error);
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
