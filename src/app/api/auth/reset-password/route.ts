import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { validateOwnerUid } from "@/lib/ownerValidation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, code, newPassword, ownerUid } = body;
    
    if (!email || !email.trim() || !code || !code.trim() || !newPassword) {
      return NextResponse.json(
        { error: "Email, code, and new password are required" },
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
    
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }
    
    // Validate password strength
    const passwordErrors: string[] = [];
    if (!/[A-Z]/.test(newPassword)) {
      passwordErrors.push("one uppercase letter");
    }
    if (!/[a-z]/.test(newPassword)) {
      passwordErrors.push("one lowercase letter");
    }
    if (!/[0-9]/.test(newPassword)) {
      passwordErrors.push("one number");
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
      passwordErrors.push("one special character");
    }
    
    if (passwordErrors.length > 0) {
      return NextResponse.json(
        { error: `Password must contain: ${passwordErrors.join(", ")}` },
        { status: 400 }
      );
    }
    
    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code.trim())) {
      return NextResponse.json(
        { error: "Invalid code format. Code must be 6 digits." },
        { status: 400 }
      );
    }
    
    try {
      // Get user from Firebase Auth
      const auth = adminAuth();
      const user = await auth.getUserByEmail(email.trim().toLowerCase());
      
      // Verify customer is registered for THIS specific salon
      const db = adminDb();
      const customerRef = db.collection("owners").doc(ownerUid).collection("customers").doc(user.uid);
      const customerDoc = await customerRef.get();
      
      if (!customerDoc.exists) {
        return NextResponse.json(
          { error: "Invalid or expired code. Please request a new one." },
          { status: 400 }
        );
      }
      
      // Verify reset code
      const codeDoc = await db.collection("passwordResetCodes").doc(user.uid).get();
      
      if (!codeDoc.exists) {
        return NextResponse.json(
          { error: "Invalid or expired code. Please request a new one." },
          { status: 400 }
        );
      }
      
      const codeData = codeDoc.data();
      
      // Verify ownerUid matches
      if (codeData?.ownerUid !== ownerUid) {
        return NextResponse.json(
          { error: "Invalid or expired code. Please request a new one." },
          { status: 400 }
        );
      }
      
      // Check if code has been used
      if (codeData?.used === true) {
        return NextResponse.json(
          { error: "This code has already been used. Please request a new one." },
          { status: 400 }
        );
      }
      
      // Check if code matches
      if (codeData?.code !== code.trim()) {
        return NextResponse.json(
          { error: "Invalid code. Please check and try again." },
          { status: 400 }
        );
      }
      
      // Check if code has expired
      const expiresAt = codeData?.expiresAt?.toDate?.();
      if (expiresAt && expiresAt < new Date()) {
        // Delete expired code
        await db.collection("passwordResetCodes").doc(user.uid).delete();
        return NextResponse.json(
          { error: "Code has expired. Please request a new one." },
          { status: 400 }
        );
      }
      
      // Verify email matches
      if (codeData?.email?.toLowerCase() !== email.trim().toLowerCase()) {
        return NextResponse.json(
          { error: "Email does not match the code." },
          { status: 400 }
        );
      }
      
      // Update password using admin SDK
      await auth.updateUser(user.uid, {
        password: newPassword,
      });
      
      // Mark code as used
      await db.collection("passwordResetCodes").doc(user.uid).update({
        used: true,
        usedAt: new Date(),
      });
      
      return NextResponse.json({
        success: true,
        message: "Password has been reset successfully. You can now login with your new password.",
      });
    } catch (error: any) {
      if (error?.code === "auth/user-not-found") {
        return NextResponse.json(
          { error: "Invalid or expired code. Please request a new one." },
          { status: 400 }
        );
      }
      
      console.error("[API] Error resetting password:", error);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to reset password. Please try again later.",
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("[API] Error resetting password:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to reset password",
      },
      { status: 500 }
    );
  }
}
