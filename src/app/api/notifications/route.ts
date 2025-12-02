import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * GET /api/notifications
 * Fetch notifications for a customer by email, phone, or customerUid
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerEmail = searchParams.get("email");
    const customerPhone = searchParams.get("phone");
    const customerUid = searchParams.get("uid");
    const limitCount = parseInt(searchParams.get("limit") || "50");

    if (!customerEmail && !customerPhone && !customerUid) {
      return NextResponse.json(
        { error: "At least one of email, phone, or uid is required" },
        { status: 400 }
      );
    }

    const db = adminDb();
    let query = db.collection("notifications");

    // Build query based on available parameters
    if (customerUid) {
      query = query.where("customerUid", "==", customerUid);
    } else if (customerEmail) {
      query = query.where("customerEmail", "==", customerEmail);
    } else if (customerPhone) {
      query = query.where("customerPhone", "==", customerPhone);
    }

    const snapshot = await query
      .orderBy("createdAt", "desc")
      .limit(limitCount)
      .get();

    const notifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ notifications });
  } catch (error: any) {
    console.error("Error fetching notifications:", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal error"
        : error?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

