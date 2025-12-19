import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { verifyAuth, isNotificationOwner } from "@/lib/authHelpers";

export const runtime = "nodejs";

/**
 * PATCH /api/notifications/[id]/read
 * Mark a notification as read
 * 
 * Security: Requires authentication. Users can only mark their own notifications as read.
 */
export async function PATCH(
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

    // Verify ownership - user can only mark their own notifications as read
    const isOwner = isNotificationOwner(notificationData, authenticatedUserId, authenticatedEmail);
    
    // Also check email match for backwards compatibility
    const emailMatch = authenticatedEmail && 
      notificationData.customerEmail && 
      notificationData.customerEmail === authenticatedEmail;

    if (!isOwner && !emailMatch) {
      return NextResponse.json(
        { error: "You do not have permission to update this notification" },
        { status: 403 }
      );
    }

    await ref.update({
      read: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Error marking notification as read:", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal error"
        : error?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
