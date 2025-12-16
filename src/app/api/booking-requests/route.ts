import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { generateBookingCode } from "@/lib/bookings";
import { getNotificationContent } from "@/lib/notifications";

export const runtime = "nodejs";

type CreateBookingRequestInput = {
  ownerUid: string;
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
  serviceId: string | number;
  serviceName?: string;
  staffId?: string | null;
  staffName?: string;
  branchId: string;
  branchName?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration: number;
  status?: string;
  price: number;
  customerUid?: string; // Customer account UID (for authenticated bookings)
  services?: Array<{ 
    id: string | number; 
    name?: string; 
    price?: number; 
    duration?: number;
    staffId?: string | null;
    staffName?: string | null;
  }>; // Multiple services
};

export async function POST(req: NextRequest) {
  try {
    // Security: Limit request size to prevent DoS attacks (CVE-2025-55184)
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const body = (await req.json()) as Partial<CreateBookingRequestInput>;

    // Basic validation
    if (!body.ownerUid) {
      return NextResponse.json({ error: "Missing field: ownerUid" }, { status: 400 });
    }
    if (!body.client || !body.client.trim()) {
      return NextResponse.json({ error: "Missing field: client" }, { status: 400 });
    }
    if (!body.serviceId) {
      return NextResponse.json({ error: "Missing field: serviceId" }, { status: 400 });
    }
    if (!body.branchId) {
      return NextResponse.json({ error: "Missing field: branchId" }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: "Missing field: date" }, { status: 400 });
    }
    if (!body.time) {
      return NextResponse.json({ error: "Missing field: time" }, { status: 400 });
    }
    if (body.duration === undefined || body.duration === null) {
      return NextResponse.json({ error: "Missing field: duration" }, { status: 400 });
    }
    if (body.price === undefined || body.price === null) {
      return NextResponse.json({ error: "Missing field: price" }, { status: 400 });
    }

    const bookingCode = generateBookingCode();
    
    const payload: any = {
      ownerUid: String(body.ownerUid),
      client: String(body.client),
      clientEmail: body.clientEmail || null,
      clientPhone: body.clientPhone || null,
      notes: body.notes || null,
      serviceId: typeof body.serviceId === "number" ? body.serviceId : String(body.serviceId),
      serviceName: body.serviceName || null,
      // Removed top-level staff assignment to rely on service-wise staff selection
      branchId: String(body.branchId),
      branchName: body.branchName || null,
      date: String(body.date),
      time: String(body.time),
      duration: Number(body.duration) || 0,
      status: body.status || "Pending",
      price: Number(body.price) || 0,
      customerUid: body.customerUid || null,
      services: body.services || null,
      bookingSource: "booking_engine",
      bookingCode: bookingCode,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const db = adminDb();
    const ref = await db.collection("bookings").add(payload);
    
    // Create notification for the customer
    try {
      const notificationPayload = {
        customerUid: body.customerUid || null,
        customerEmail: body.clientEmail || null,
        customerPhone: body.clientPhone || null,
        bookingId: ref.id,
        bookingCode: bookingCode,
        type: "booking_status_changed",
        title: "Booking Request Received",
        message: getNotificationContent(
          "Pending",
          bookingCode,
          body.staffName || undefined,
          body.serviceName || undefined,
          body.date,
          body.time,
          body.services?.map(s => ({
            name: s.name || "Service",
            staffName: s.staffName || "Any Available"
          }))
        ).message,
        status: "Pending",
        read: false,
        ownerUid: String(body.ownerUid),
        // Additional details for better notification display
        staffName: body.staffName || null,
        serviceName: body.serviceName || null,
        branchName: body.branchName || null,
        bookingDate: body.date || null,
        bookingTime: body.time || null,
        services: body.services?.map(s => ({
          name: s.name || "Service",
          staffName: s.staffName || "Any Available"
        })) || null,
        createdAt: FieldValue.serverTimestamp(),
      };
      
      await db.collection("notifications").add(notificationPayload);
    } catch (notifError) {
      // Log error but don't fail the booking creation
      console.error("Error creating notification:", notifError);
    }
    
    return NextResponse.json({ id: ref.id, bookingCode: bookingCode });
  } catch (e: any) {
    console.error("Create booking request API error:", e);
    
    // Provide helpful error messages even in production
    let errorMessage = "Internal error";
    if (e?.message) {
      if (e.message.includes("credentials") || e.message.includes("Firebase Admin")) {
        errorMessage = "Server configuration error. Please contact support.";
      } else if (e.message.includes("permission") || e.message.includes("PERMISSION_DENIED")) {
        errorMessage = "Database permission error. Please contact support.";
      } else if (process.env.NODE_ENV !== "production") {
        errorMessage = e.message;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage, 
        details: process.env.NODE_ENV !== "production" ? e?.stack : undefined,
        helpText: "If this error persists, please ensure Firebase Admin credentials are configured on the server."
      },
      { status: 500 }
    );
  }
}

