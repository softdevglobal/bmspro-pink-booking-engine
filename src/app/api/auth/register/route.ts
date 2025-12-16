import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";

export async function POST(request: NextRequest) {
  try {
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

    try {
      // Create Firebase Auth user
      const auth = getAuth(getAdminApp());
      const userRecord = await auth.createUser({
        email,
        password,
        displayName: fullName,
      });

      // Create customer document in Firestore
      const db = adminDb();
      const customerRef = db.collection("customers").doc(userRecord.uid);
      
      await customerRef.set({
        uid: userRecord.uid,
        email: email,
        fullName: fullName,
        phone: phone || "",
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
