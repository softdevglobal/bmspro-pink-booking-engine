import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAuth, isNotificationOwner } from "@/lib/authHelpers";

export const runtime = "nodejs";

/**
 * DELETE /api/notifications/[id]
 * Delete a notification
 * 
 * Security: Requires authentication. Users can only delete their own notifications.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(req);
    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const authenticatedUserId = authResult.user.uid;
    const authenticatedEmail = authResult.user.email;

    const { id } = await context.params;

    const db = adminDb();
    const ref = db.doc(`notifications/${id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const notificationData = snap.data() as {
      customerUid?: string | null;
      customerEmail?: string | null;
      staffUid?: string | null;
      ownerUid?: string | null;
      targetAdminUid?: string | null;
    };

    // Verify ownership - user can only delete their own notifications
    const isOwner = isNotificationOwner(notificationData, authenticatedUserId, authenticatedEmail);
    
    // Also check email match for backwards compatibility
    const emailMatch = authenticatedEmail && 
      notificationData.customerEmail && 
      notificationData.customerEmail === authenticatedEmail;

    if (!isOwner && !emailMatch) {
      return NextResponse.json(
        { error: "You do not have permission to delete this notification" },
        { status: 403 }
      );
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
