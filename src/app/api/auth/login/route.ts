import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";
import { validateOwnerUid } from "@/lib/ownerValidation";

export async function POST(request: NextRequest) {
  try {
    // Security: Rate limiting to prevent brute force attacks
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.auth);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many login attempts. Please try again later.",
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rateLimitResult.resetTime),
          },
        }
      );
    }

    // Security: Limit request size to prevent DoS attacks (CVE-2025-55184)
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const body = await request.json();
    const { email, ownerUid } = body;

    // Validate ownerUid - required for salon-specific login verification
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

    // Validate input
    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Security: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    try {
      // Get user by email from Firebase Auth
      const auth = getAuth(getAdminApp());
      const userRecord = await auth.getUserByEmail(email);

      // Check if customer is registered for THIS specific salon
      // Structure: owners/{ownerUid}/customers/{customerUid}
      const db = adminDb();
      const customerRef = db.collection("owners").doc(ownerUid).collection("customers").doc(userRecord.uid);
      const customerDoc = await customerRef.get();

      if (!customerDoc.exists) {
        // User exists in Firebase Auth but not registered for this salon
        return NextResponse.json(
          { 
            error: "You are not registered for this salon. Please create an account first.",
            needsRegistration: true 
          },
          { status: 404 }
        );
      }

      const customerData = customerDoc.data();

      // Create custom token for authentication
      const customToken = await auth.createCustomToken(userRecord.uid);

      return NextResponse.json(
        {
          success: true,
          message: "Login successful",
          customToken,
          customer: {
            uid: userRecord.uid,
            email: customerData?.email,
            fullName: customerData?.fullName,
            phone: customerData?.phone,
          },
        },
        { status: 200 }
      );
    } catch (authError: any) {
      console.error("Firebase Auth error:", authError);
      
      if (authError.code === "auth/user-not-found") {
        return NextResponse.json(
          { error: "No account found with this email" },
          { status: 404 }
        );
      }
      
      throw authError;
    }
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to login" },
      { status: 500 }
    );
  }
}
