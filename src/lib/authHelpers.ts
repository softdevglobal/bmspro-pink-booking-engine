import { NextRequest } from "next/server";
import { adminAuth } from "./firebaseAdmin";
import { DecodedIdToken } from "firebase-admin/auth";

/**
 * Result of authentication verification
 */
export type AuthResult = {
  success: true;
  user: DecodedIdToken;
} | {
  success: false;
  error: string;
  status: number;
};

/**
 * Verify Firebase ID token from Authorization header
 * 
 * @param req - NextRequest object
 * @returns AuthResult with user data or error details
 * 
 * @example
 * ```typescript
 * const authResult = await verifyAuth(req);
 * if (!authResult.success) {
 *   return NextResponse.json({ error: authResult.error }, { status: authResult.status });
 * }
 * const userId = authResult.user.uid;
 * ```
 */
export async function verifyAuth(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization");
  
  if (!authHeader) {
    return {
      success: false,
      error: "Authorization header is required",
      status: 401,
    };
  }
  
  if (!authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      error: "Invalid authorization format. Use 'Bearer <token>'",
      status: 401,
    };
  }
  
  const token = authHeader.slice(7); // Remove "Bearer " prefix
  
  if (!token) {
    return {
      success: false,
      error: "Token is required",
      status: 401,
    };
  }
  
  try {
    const decodedToken = await adminAuth().verifyIdToken(token);
    return {
      success: true,
      user: decodedToken,
    };
  } catch (error: any) {
    console.error("Token verification failed:", error?.code || error?.message);
    
    // Handle specific Firebase Auth errors
    if (error?.code === "auth/id-token-expired") {
      return {
        success: false,
        error: "Token expired. Please sign in again.",
        status: 401,
      };
    }
    
    if (error?.code === "auth/id-token-revoked") {
      return {
        success: false,
        error: "Token has been revoked. Please sign in again.",
        status: 401,
      };
    }
    
    if (error?.code === "auth/argument-error") {
      return {
        success: false,
        error: "Invalid token format",
        status: 401,
      };
    }
    
    return {
      success: false,
      error: "Invalid or expired token",
      status: 401,
    };
  }
}

/**
 * Check if the authenticated user owns the notification
 * 
 * @param notificationData - The notification document data
 * @param userId - The authenticated user's UID
 * @returns true if user owns the notification
 */
export function isNotificationOwner(
  notificationData: { 
    customerUid?: string | null; 
    customerEmail?: string | null;
    staffUid?: string | null;
    ownerUid?: string | null;
    targetAdminUid?: string | null;
  },
  userId: string,
  userEmail?: string | null
): boolean {
  // Check if user is the customer (by UID)
  if (notificationData.customerUid && notificationData.customerUid === userId) {
    return true;
  }
  
  // Check if user is assigned staff
  if (notificationData.staffUid && notificationData.staffUid === userId) {
    return true;
  }
  
  // Check if user is the salon owner
  if (notificationData.ownerUid && notificationData.ownerUid === userId) {
    return true;
  }
  
  // Check if user is the target admin
  if (notificationData.targetAdminUid && notificationData.targetAdminUid === userId) {
    return true;
  }
  
  return false;
}
