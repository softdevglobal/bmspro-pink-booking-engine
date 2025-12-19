import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";

export async function POST(request: NextRequest) {
  try {
    // Security: Rate limiting to prevent registration abuse
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.registration);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many registration attempts. Please try again later.",
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
    const { email, password, fullName, phone } = body;

    // Validate input
    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: "Email, password, and full name are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Security: Validate fullName length and format
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return NextResponse.json(
        { error: "Full name must be between 2 and 100 characters" },
        { status: 400 }
      );
    }

    // Security: Sanitize phone number (if provided)
    let sanitizedPhone = "";
    if (phone) {
      sanitizedPhone = phone.replace(/[^0-9+\-\s()]/g, "").trim();
      if (sanitizedPhone.length > 20) {
        return NextResponse.json(
          { error: "Invalid phone number format" },
          { status: 400 }
        );
      }
    }

    try {
      // Create Firebase Auth user
      const auth = getAuth(getAdminApp());
      const userRecord = await auth.createUser({
        email,
        password,
        displayName: trimmedName,
      });

      // Create customer document in Firestore
      const db = adminDb();
      const customerRef = db.collection("customers").doc(userRecord.uid);
      
      await customerRef.set({
        uid: userRecord.uid,
        email: email,
        fullName: trimmedName,
        phone: sanitizedPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalBookings: 0,
      });

      return NextResponse.json(
        {
          success: true,
          message: "Customer account created successfully",
          uid: userRecord.uid,
        },
        { status: 201 }
      );
    } catch (authError: any) {
      console.error("Firebase Auth error:", authError);
      
      if (authError.code === "auth/email-already-exists") {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      
      throw authError;
    }
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create customer account" },
      { status: 500 }
    );
  }
}
