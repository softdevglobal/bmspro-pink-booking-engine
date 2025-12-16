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

    // Validate that the requested time slots are not already booked
    const db = adminDb();
    const dateStr = String(body.date);
    
    // Helper function to check if two time ranges overlap
    const timeRangesOverlap = (
      start1: number, end1: number,
      start2: number, end2: number
    ): boolean => {
      // Overlap occurs if: start1 < end2 && start2 < end1
      return start1 < end2 && start2 < end1;
    };

    // Helper function to parse time string to minutes
    const timeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':').map(Number);
      if (parts.length < 2) return 0;
      return parts[0] * 60 + parts[1];
    };

    // Helper function to check if a booking status is active (should block slots)
    const isActiveStatus = (status: string | undefined): boolean => {
      if (!status) return true; // No status = assume active
      const lowerStatus = status.toLowerCase();
      const inactiveStatuses = ['cancelled', 'canceled', 'completed', 'staffrejected', 'rejected'];
      return !inactiveStatuses.includes(lowerStatus);
    };

    // Check for existing bookings that would conflict
    try {
      // Query bookings for the same date
      const bookingsQuery = db.collection("bookings")
        .where("ownerUid", "==", String(body.ownerUid))
        .where("date", "==", dateStr);
      
      const bookingRequestsQuery = db.collection("bookingRequests")
        .where("ownerUid", "==", String(body.ownerUid))
        .where("date", "==", dateStr);

      const [bookingsSnapshot, bookingRequestsSnapshot] = await Promise.all([
        bookingsQuery.get().catch(() => ({ docs: [] })),
        bookingRequestsQuery.get().catch(() => ({ docs: [] }))
      ]);

      // Combine results from both collections
      const allExistingBookings = [
        ...bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...bookingRequestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      ];

      // Check each service in the new booking request
      const servicesToCheck = body.services && Array.isArray(body.services) && body.services.length > 0
        ? body.services
        : [{
            id: body.serviceId,
            time: body.time,
            duration: body.duration,
            staffId: body.staffId || null
          }];

      for (const newService of servicesToCheck) {
        const newServiceTime = newService.time || body.time;
        const newServiceDuration = newService.duration || body.duration;
        const newServiceStaffId = newService.staffId || body.staffId || null;

        if (!newServiceTime) continue;

        const newStartMinutes = timeToMinutes(newServiceTime);
        const newEndMinutes = newStartMinutes + newServiceDuration;

        // Check against all existing bookings
        for (const existingBooking of allExistingBookings) {
          // Skip if booking is not active
          if (!isActiveStatus(existingBooking.status)) continue;

          // Check if this is a multi-service booking
          if (existingBooking.services && Array.isArray(existingBooking.services) && existingBooking.services.length > 0) {
            // Check each service in the existing booking
            for (const existingService of existingBooking.services) {
              if (!existingService.time) continue;
              
              const existingServiceStaffId = existingService.staffId || existingBooking.staffId || null;
              
              // Only check if same staff (or both are "any staff")
              if (newServiceStaffId && existingServiceStaffId) {
                if (newServiceStaffId !== existingServiceStaffId) continue;
              } else if (newServiceStaffId || existingServiceStaffId) {
                // If one has staff and other doesn't, they might conflict
                // For safety, we'll check them
              }

              const existingStartMinutes = timeToMinutes(existingService.time);
              const existingDuration = existingService.duration || existingBooking.duration || 60;
              const existingEndMinutes = existingStartMinutes + existingDuration;

              // Check for overlap
              if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
                return NextResponse.json(
                  { 
                    error: "Time slot already booked",
                    details: `The selected time ${newServiceTime} conflicts with an existing booking. Please choose a different time.`
                  },
                  { status: 409 } // 409 Conflict
                );
              }
            }
          } else {
            // Single-service booking
            if (!existingBooking.time) continue;

            const existingStaffId = existingBooking.staffId || null;
            
            // Only check if same staff (or both are "any staff")
            if (newServiceStaffId && existingStaffId) {
              if (newServiceStaffId !== existingStaffId) continue;
            } else if (newServiceStaffId || existingStaffId) {
              // If one has staff and other doesn't, they might conflict
              // For safety, we'll check them
            }

            const existingStartMinutes = timeToMinutes(existingBooking.time);
            const existingDuration = existingBooking.duration || 60;
            const existingEndMinutes = existingStartMinutes + existingDuration;

            // Check for overlap
            if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
              return NextResponse.json(
                { 
                  error: "Time slot already booked",
                  details: `The selected time ${newServiceTime} conflicts with an existing booking. Please choose a different time.`
                },
                { status: 409 } // 409 Conflict
              );
            }
          }
        }
      }
    } catch (validationError: any) {
      // Log the error but don't fail the booking if validation query fails
      // This is a safety check, so we'll proceed if we can't verify
      console.error("Error validating booking availability:", validationError);
      // In production, you might want to be more strict and reject the booking
      // For now, we'll proceed but log the error
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

