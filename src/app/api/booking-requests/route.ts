import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { generateBookingCode } from "@/lib/bookings";

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
  services?: Array<{ id: string | number; name?: string; price?: number; duration?: number }>; // Multiple services
};

export async function POST(req: NextRequest) {
  try {
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
      staffId: body.staffId || null,
      staffName: body.staffName || null,
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

