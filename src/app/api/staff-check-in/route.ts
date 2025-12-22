import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { 
  performStaffCheckIn, 
  performStaffCheckOut, 
  getActiveCheckIn,
  getStaffCheckInHistory 
} from "@/lib/staffCheckIn";

// Rate limiting - simple in-memory store (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10; // Max 10 check-ins per minute per user

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (userLimit.count >= MAX_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

/**
 * POST /api/staff-check-in
 * Perform a staff check-in with location validation
 */
export async function POST(request: NextRequest) {
  try {
    // Get auth token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = await adminAuth().verifyIdToken(token);
    } catch (error) {
      console.error("Token verification failed:", error);
      return NextResponse.json(
        { success: false, message: "Invalid token" },
        { status: 401 }
      );
    }

    const staffId = decodedToken.uid;

    // Rate limiting
    if (!checkRateLimit(staffId)) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { branchId, latitude, longitude, staffName, staffRole } = body;

    // Validate required fields
    if (!branchId || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: branchId, latitude, longitude" },
        { status: 400 }
      );
    }

    // Validate coordinate types
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json(
        { success: false, message: "Invalid coordinates format" },
        { status: 400 }
      );
    }

    // Get owner UID from user's custom claims or fetch from user doc
    const ownerUid = decodedToken.ownerUid || decodedToken.uid;

    // Get device info from headers
    const deviceInfo = {
      platform: request.headers.get("sec-ch-ua-platform") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    };

    // Perform check-in
    const result = await performStaffCheckIn(ownerUid, {
      staffId,
      staffName: staffName || decodedToken.name || "Unknown Staff",
      staffRole,
      branchId,
      staffLatitude: latitude,
      staffLongitude: longitude,
      deviceInfo,
    });

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(result, { status: 400 });
    }
  } catch (error) {
    console.error("Check-in API error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/staff-check-in
 * Perform a staff check-out
 */
export async function PUT(request: NextRequest) {
  try {
    // Get auth token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = await adminAuth().verifyIdToken(token);
    } catch (error) {
      console.error("Token verification failed:", error);
      return NextResponse.json(
        { success: false, message: "Invalid token" },
        { status: 401 }
      );
    }

    const staffId = decodedToken.uid;

    // Parse request body
    const body = await request.json();
    const { checkInId } = body;

    if (!checkInId) {
      return NextResponse.json(
        { success: false, message: "Missing checkInId" },
        { status: 400 }
      );
    }

    // Perform check-out
    const result = await performStaffCheckOut({
      staffId,
      checkInId,
    });

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(result, { status: 400 });
    }
  } catch (error) {
    console.error("Check-out API error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/staff-check-in
 * Get current check-in status or history
 */
export async function GET(request: NextRequest) {
  try {
    // Get auth token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = await adminAuth().verifyIdToken(token);
    } catch (error) {
      console.error("Token verification failed:", error);
      return NextResponse.json(
        { success: false, message: "Invalid token" },
        { status: 401 }
      );
    }

    const staffId = decodedToken.uid;

    // Check query params
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "active";

    if (type === "active") {
      // Get active check-in
      const activeCheckIn = await getActiveCheckIn(staffId);
      return NextResponse.json({
        success: true,
        hasActiveCheckIn: !!activeCheckIn,
        checkIn: activeCheckIn,
      });
    } else if (type === "history") {
      // Get check-in history
      const limit = parseInt(searchParams.get("limit") || "30", 10);
      const history = await getStaffCheckInHistory(staffId, limit);
      return NextResponse.json({
        success: true,
        history,
      });
    } else {
      return NextResponse.json(
        { success: false, message: "Invalid type parameter" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Get check-in API error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
