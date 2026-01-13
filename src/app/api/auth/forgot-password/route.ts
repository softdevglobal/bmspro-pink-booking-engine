import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { sendPasswordResetEmail } from "@/lib/emailService";
import { FieldValue } from "firebase-admin/firestore";
import { validateOwnerUid } from "@/lib/ownerValidation";

export const runtime = "nodejs";

// Generate a 6-digit verification code
function generateResetCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, ownerUid } = body;
    
    if (!email || !email.trim()) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!ownerUid) {
      return NextResponse.json(
        { error: "Salon identifier is required" },
        { status: 400 }
      );
    }

    // Validate the owner exists and is active
    const ownerValidation = await validateOwnerUid(ownerUid);
    if (!ownerValidation.valid) {
      return NextResponse.json(
        { error: ownerValidation.error || "Invalid salon" },
        { status: 400 }
      );
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }
    
    try {
      // Check if user exists in Firebase Auth
      const auth = adminAuth();
      const user = await auth.getUserByEmail(email.trim().toLowerCase());
      
      // Verify the customer is registered for THIS specific salon
      const db = adminDb();
      const customerRef = db.collection("owners").doc(ownerUid).collection("customers").doc(user.uid);
      const customerDoc = await customerRef.get();
      
      if (!customerDoc.exists) {
        // Don't reveal if customer doesn't exist for this salon - return success anyway for security
        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, a password reset code has been sent.",
        });
      }
      
      const customerData = customerDoc.data();
      
      // Generate 6-digit reset code
      const resetCode = generateResetCode();
      const expirationTime = new Date();
      expirationTime.setMinutes(expirationTime.getMinutes() + 15); // Code expires in 15 minutes
      
      // Store the reset code in Firestore
      await db.collection("passwordResetCodes").doc(user.uid).set({
        email: email.trim().toLowerCase(),
        code: resetCode,
        expiresAt: expirationTime,
        createdAt: FieldValue.serverTimestamp(),
        used: false,
        ownerUid: ownerUid, // Store ownerUid for verification
      });
      
      // Get customer name for email
      const userName = customerData?.fullName || customerData?.email || email.trim().toLowerCase();
      
      // Send password reset email with code
      await sendPasswordResetEmail(email.trim().toLowerCase(), userName, resetCode);
      
      return NextResponse.json({
        success: true,
        message: "If an account exists with this email, a password reset code has been sent.",
      });
    } catch (error: any) {
      // Don't reveal if user doesn't exist - return success anyway for security
      if (error?.code === "auth/user-not-found") {
        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, a password reset code has been sent.",
        });
      }
      
      console.error("[API] Error in forgot password:", error);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to process password reset request. Please try again later.",
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("[API] Error in forgot password:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to process password reset request",
      },
      { status: 500 }
    );
  }
}
