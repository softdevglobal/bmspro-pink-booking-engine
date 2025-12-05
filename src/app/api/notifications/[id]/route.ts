import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * DELETE /api/notifications/[id]
 * Delete a notification
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const db = adminDb();
    const ref = db.doc(`notifications/${id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    await ref.delete();

    return NextResponse.json({ ok: true, message: "Notification deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting notification:", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal error"
        : error?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

