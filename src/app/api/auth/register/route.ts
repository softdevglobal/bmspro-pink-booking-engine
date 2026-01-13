import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";
import { validateOwnerUid } from "@/lib/ownerValidation";
import { sendWelcomeEmail } from "@/lib/emailService";

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
    const { email, password, fullName, phone, ownerUid } = body;

    // Validate ownerUid - required for salon-specific registration
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

    const db = adminDb();
    const auth = getAuth(getAdminApp());
    let userRecord;
    let isExistingUser = false;

    try {
      // Check if user already exists in Firebase Auth
      userRecord = await auth.getUserByEmail(email);
      isExistingUser = true;
      
      // User exists - check if they're already registered for this salon
      const existingCustomerRef = db.collection("owners").doc(ownerUid).collection("customers").doc(userRecord.uid);
      const existingCustomer = await existingCustomerRef.get();
      
      if (existingCustomer.exists) {
        return NextResponse.json(
          { error: "You are already registered for this salon. Please login instead." },
          { status: 409 }
        );
      }
      
      // User exists in Firebase Auth but not registered for this salon
      // We'll create a salon-specific customer record below
    } catch (authError: any) {
      if (authError.code === "auth/user-not-found") {
        // User doesn't exist - create new Firebase Auth user
        try {
          userRecord = await auth.createUser({
            email,
            password,
            displayName: trimmedName,
          });
        } catch (createError: any) {
          console.error("Firebase Auth create error:", createError);
          throw createError;
        }
      } else {
        throw authError;
      }
    }

    // Create salon-specific customer document in Firestore
    // Structure: owners/{ownerUid}/customers/{customerUid}
    const customerRef = db.collection("owners").doc(ownerUid).collection("customers").doc(userRecord.uid);
    
    await customerRef.set({
      uid: userRecord.uid,
      email: email,
      fullName: trimmedName,
      phone: sanitizedPhone,
      ownerUid: ownerUid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalBookings: 0,
    });

    // Send welcome email (don't block registration if email fails)
    try {
      await sendWelcomeEmail(email, trimmedName, ownerUid);
    } catch (emailError: any) {
      console.error("Failed to send welcome email:", emailError);
      // Don't fail registration if email fails
    }

    return NextResponse.json(
      {
        success: true,
        message: isExistingUser 
          ? "Successfully registered for this salon" 
          : "Customer account created successfully",
        uid: userRecord.uid,
        isExistingUser,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create customer account" },
      { status: 500 }
    );
  }
}
