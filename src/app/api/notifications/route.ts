import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAuth } from "@/lib/authHelpers";

export const runtime = "nodejs";

/**
 * GET /api/notifications
 * Fetch notifications for the authenticated customer
 * 
 * Security: Requires authentication. Users can only fetch their own notifications.
 * The customerUid is derived from the authenticated token, not from query params.
 */
export async function GET(req: NextRequest) {
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
    
    const { searchParams } = new URL(req.url);
    const limitCount = parseInt(searchParams.get("limit") || "200");

    const db = adminDb();
    
    // Build queries for notifications that belong to this user
    // A notification belongs to the user if:
    // 1. customerUid matches (for customer notifications)
    // 2. staffUid matches (for staff notifications) 
    // 3. ownerUid matches (for owner notifications)
    // 4. targetAdminUid matches (for admin notifications)
    
    // We need to run multiple queries since Firestore doesn't support OR in where clauses
    const queries = [
      // Customer notifications (by UID)
      db.collection("notifications")
        .where("customerUid", "==", authenticatedUserId)
        .orderBy("createdAt", "desc")
        .limit(limitCount),
    ];
    
    // Also check by email if available (for backwards compatibility with older notifications)
    if (authenticatedEmail) {
      queries.push(
        db.collection("notifications")
          .where("customerEmail", "==", authenticatedEmail)
          .orderBy("createdAt", "desc")
          .limit(limitCount)
      );
    }

    // Execute all queries in parallel
    const snapshots = await Promise.all(
      queries.map(q => q.get().catch(() => ({ docs: [] })))
    );

    // Merge results and remove duplicates
    const notificationMap = new Map<string, any>();
    
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        if (!notificationMap.has(doc.id)) {
          const data = doc.data();
          notificationMap.set(doc.id, {
            id: doc.id,
            ...data,
            // Convert Firestore Timestamp to serializable format
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          });
        }
      }
    }

    // Convert to array and sort by createdAt descending
    const notifications = Array.from(notificationMap.values())
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, limitCount);

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
