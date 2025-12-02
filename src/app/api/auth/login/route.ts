import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    try {
      // Get user by email from Firebase Auth
      const auth = getAuth(getAdminApp());
      const userRecord = await auth.getUserByEmail(email);

      // Check if customer document exists in Firestore
      const db = adminDb();
      const customerRef = db.collection("customers").doc(userRecord.uid);
      const customerDoc = await customerRef.get();

      if (!customerDoc.exists) {
        return NextResponse.json(
          { error: "Customer account not found" },
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
