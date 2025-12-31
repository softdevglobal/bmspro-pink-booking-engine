import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { Message } from "firebase-admin/messaging";
import { generateBookingCode } from "@/lib/bookings";
import { getNotificationContent } from "@/lib/notifications";
import { shouldBlockSlots } from "@/lib/bookingTypes";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";
import { validateOwnerUid } from "@/lib/ownerValidation";

/**
 * Check if a staff ID is a valid assigned staff (not "Any Available" or empty)
 */
function isValidStaffAssignment(staffId?: string | null): boolean {
  if (!staffId) return false;
  if (staffId === "null" || staffId === "") return false;
  // "Any Available" type values
  if (staffId.toLowerCase().includes("any")) return false;
  return true;
}

/**
 * Analyze staff assignments in a booking
 * Returns details about which services have staff and which don't
 */
function analyzeStaffAssignments(
  services?: Array<{ staffId?: string | null; staffName?: string | null }>,
  staffId?: string | null
): { 
  hasAnyAssignedStaff: boolean;  // At least one service has staff
  hasAnyUnassignedStaff: boolean;  // At least one service needs staff assignment
  allAssigned: boolean;  // All services have staff
  noneAssigned: boolean;  // No services have staff
} {
  // Check services array for multi-service bookings
  if (services && Array.isArray(services) && services.length > 0) {
    const assignedCount = services.filter(s => isValidStaffAssignment(s.staffId)).length;
    const totalCount = services.length;
    
    return {
      hasAnyAssignedStaff: assignedCount > 0,
      hasAnyUnassignedStaff: assignedCount < totalCount,
      allAssigned: assignedCount === totalCount,
      noneAssigned: assignedCount === 0,
    };
  }
  
  // Single service booking
  const isAssigned = isValidStaffAssignment(staffId);
  return {
    hasAnyAssignedStaff: isAssigned,
    hasAnyUnassignedStaff: !isAssigned,
    allAssigned: isAssigned,
    noneAssigned: !isAssigned,
  };
}

/**
 * Get FCM token for a user
 */
async function getUserFcmToken(db: FirebaseFirestore.Firestore, userUid: string): Promise<string | null> {
  try {
    // Check users collection first
    const userDoc = await db.collection("users").doc(userUid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData?.fcmToken) {
        return userData.fcmToken;
      }
    }
    
    // Also check salon_staff collection
    const staffDoc = await db.collection("salon_staff").doc(userUid).get();
    if (staffDoc.exists) {
      const staffData = staffDoc.data();
      if (staffData?.fcmToken) {
        return staffData.fcmToken;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error getting FCM token for user:", userUid, error);
    return null;
  }
}

/**
 * Send FCM push notification
 */
async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const messaging = adminMessaging();
    
    const message: Message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: data || {},
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "appointments",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    await messaging.send(message);
    console.log("✅ Push notification sent successfully");
  } catch (error: any) {
    // Don't throw error - push notification failure shouldn't break notification creation
    console.error("⚠️ Error sending push notification:", error?.message || error);
    if (error?.code === "messaging/invalid-registration-token" || 
        error?.code === "messaging/registration-token-not-registered") {
      console.log("Invalid FCM token detected, but continuing with notification creation");
    }
  }
}

/**
 * Get branch admin UID for a branch
 */
async function getBranchAdminUid(db: FirebaseFirestore.Firestore, branchId: string): Promise<string | null> {
  try {
    const branchDoc = await db.collection("branches").doc(branchId).get();
    if (branchDoc.exists) {
      const branchData = branchDoc.data();
      return branchData?.adminStaffId || null;
    }
    return null;
  } catch (error) {
    console.error("Error getting branch admin:", error);
    return null;
  }
}

/**
 * Create staff assignment notification
 */
async function createStaffAssignmentNotification(db: FirebaseFirestore.Firestore, data: {
  bookingId: string;
  bookingCode?: string;
  staffUid: string;
  staffName?: string;
  clientName: string;
  clientPhone?: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
  duration?: number;
  price?: number;
  ownerUid: string;
}): Promise<void> {
  const serviceList = data.services && data.services.length > 0
    ? data.services.filter(s => s.staffId === data.staffUid).map(s => s.name).join(", ")
    : data.serviceName || "Service";

  const title = "New Appointment Request";
  const message = `You have a new appointment request from ${data.clientName} for ${serviceList} on ${data.bookingDate} at ${data.bookingTime}. Please accept or reject this booking.`;

  const notificationPayload = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode || null,
    type: "staff_assignment",
    title,
    message,
    status: "AwaitingStaffApproval",
    ownerUid: data.ownerUid,
    staffUid: data.staffUid,
    staffName: data.staffName || null,
    clientName: data.clientName,
    clientPhone: data.clientPhone || null,
    serviceName: data.serviceName || null,
    services: data.services || null,
    branchName: data.branchName || null,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
    duration: data.duration || null,
    price: data.price || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const notifRef = await db.collection("notifications").add(notificationPayload);
  
  // Send FCM push notification to the staff member
  const fcmToken = await getUserFcmToken(db, data.staffUid);
  if (fcmToken) {
    await sendPushNotification(fcmToken, title, message, {
      notificationId: notifRef.id,
      type: "staff_assignment",
      bookingId: data.bookingId,
      bookingCode: data.bookingCode || "",
    });
  } else {
    console.log(`⚠️ No FCM token found for staff ${data.staffUid}, skipping push notification`);
  }
}

/**
 * Create owner notification for new booking
 */
async function createOwnerNotification(db: FirebaseFirestore.Firestore, data: {
  bookingId: string;
  bookingCode?: string;
  ownerUid: string;
  clientName: string;
  clientPhone?: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
  duration?: number;
  price?: number;
  status: string;
}): Promise<void> {
  const serviceList = data.services && data.services.length > 0
    ? data.services.map(s => s.name).join(", ")
    : data.serviceName || "Service";

  const title = "New Booking from Booking Engine";
  const message = `New booking from ${data.clientName} for ${serviceList} on ${data.bookingDate} at ${data.bookingTime} at ${data.branchName || "your salon"}.`;

  const notificationPayload = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode || null,
    type: "booking_engine_new_booking",
    title,
    message,
    status: data.status,
    ownerUid: data.ownerUid,
    targetOwnerUid: data.ownerUid, // Explicitly target the owner
    clientName: data.clientName,
    clientPhone: data.clientPhone || null,
    serviceName: data.serviceName || null,
    services: data.services || null,
    branchName: data.branchName || null,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
    duration: data.duration || null,
    price: data.price || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const notifRef = await db.collection("notifications").add(notificationPayload);
  
  // Send FCM push notification to the owner
  const fcmToken = await getUserFcmToken(db, data.ownerUid);
  if (fcmToken) {
    await sendPushNotification(fcmToken, title, message, {
      notificationId: notifRef.id,
      type: "booking_engine_new_booking",
      bookingId: data.bookingId,
      bookingCode: data.bookingCode || "",
    });
    console.log(`✅ Push notification sent to owner ${data.ownerUid}`);
  } else {
    console.log(`⚠️ No FCM token found for owner ${data.ownerUid}, skipping push notification`);
  }
}

/**
 * Create branch admin notification for new booking
 */
async function createBranchAdminNotification(db: FirebaseFirestore.Firestore, data: {
  bookingId: string;
  bookingCode?: string;
  branchId: string;
  branchAdminUid: string;
  clientName: string;
  clientPhone?: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
  duration?: number;
  price?: number;
  ownerUid: string;
  status: string;
}): Promise<void> {
  const serviceList = data.services && data.services.length > 0
    ? data.services.map(s => s.name).join(", ")
    : data.serviceName || "Service";

  const title = "New Booking at Your Branch";
  const message = `New booking from ${data.clientName} for ${serviceList} on ${data.bookingDate} at ${data.bookingTime} at ${data.branchName || "your branch"}.`;

  const notificationPayload = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode || null,
    type: "branch_booking_created",
    title,
    message,
    status: data.status,
    ownerUid: data.ownerUid,
    branchAdminUid: data.branchAdminUid,
    targetAdminUid: data.branchAdminUid, // For targeting branch admin
    branchId: data.branchId,
    clientName: data.clientName,
    clientPhone: data.clientPhone || null,
    serviceName: data.serviceName || null,
    services: data.services || null,
    branchName: data.branchName || null,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
    duration: data.duration || null,
    price: data.price || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const notifRef = await db.collection("notifications").add(notificationPayload);
  
  // Send FCM push notification to the branch admin
  const fcmToken = await getUserFcmToken(db, data.branchAdminUid);
  if (fcmToken) {
    await sendPushNotification(fcmToken, title, message, {
      notificationId: notifRef.id,
      type: "branch_booking_created",
      bookingId: data.bookingId,
      bookingCode: data.bookingCode || "",
    });
  } else {
    console.log(`⚠️ No FCM token found for branch admin ${data.branchAdminUid}, skipping push notification`);
  }
}

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
    // Security: Rate limiting to prevent booking spam
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.booking);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many booking requests. Please try again later.",
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
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const body = (await req.json()) as Partial<CreateBookingRequestInput>;

    // Basic validation
    if (!body.ownerUid) {
      return NextResponse.json({ error: "Missing field: ownerUid" }, { status: 400 });
    }

    // Security: Validate that ownerUid is a valid, active salon owner
    const ownerValidation = await validateOwnerUid(body.ownerUid);
    if (!ownerValidation.valid) {
      return NextResponse.json(
        { error: ownerValidation.error || "Invalid salon" },
        { status: 404 }
      );
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

    // Use centralized helper to check if booking status should block slots
    const isActiveStatus = (status: string | undefined): boolean => {
      return shouldBlockSlots(status);
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
      const allExistingBookings: Array<any> = [
        ...bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...bookingRequestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      ];

      // Check each service in the new booking request
      const servicesToCheck: Array<any> = body.services && Array.isArray(body.services) && body.services.length > 0
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
    
    // Analyze staff assignments to determine workflow
    const staffAnalysis = analyzeStaffAssignments(body.services, body.staffId);
    
    // Initialize services with approval status
    let processedServices = body.services || null;
    if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
      processedServices = processedServices.map(service => ({
        ...service,
        // Services with valid staff get "pending" approval status
        // Services without staff (Any Available) get "needs_assignment" status
        approvalStatus: isValidStaffAssignment(service.staffId) ? "pending" : "needs_assignment",
      }));
    }
    
    // Determine initial status based on staff assignments:
    // - ANY service has specific staff → AwaitingStaffApproval (those staff can respond)
    // - ALL services are "Any Available" → Pending (goes to admin first)
    // 
    // Scenarios:
    // A: All staff assigned → AwaitingStaffApproval → All staff notified
    // B: John + Any Available → AwaitingStaffApproval → John notified + Admin notified for assignment
    // C: All Any Available → Pending → Admin assigns all staff
    const initialStatus = staffAnalysis.hasAnyAssignedStaff ? "AwaitingStaffApproval" : "Pending";
    
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
      status: initialStatus,
      price: Number(body.price) || 0,
      customerUid: body.customerUid || null,
      services: processedServices,
      bookingSource: "booking_engine",
      bookingCode: bookingCode,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection("bookings").add(payload);
    
    // Create notification for the customer (booking received)
    try {
      const customerNotificationContent = getNotificationContent(
        initialStatus,
        bookingCode,
        body.staffName || undefined,
        body.serviceName || undefined,
        body.date,
        body.time,
        body.services?.map(s => ({
          name: s.name || "Service",
          staffName: s.staffName || "Any Available"
        }))
      );
      
      const customerNotificationPayload = {
        customerUid: body.customerUid || null,
        customerEmail: body.clientEmail || null,
        customerPhone: body.clientPhone || null,
        bookingId: ref.id,
        bookingCode: bookingCode,
        type: customerNotificationContent.type,
        title: customerNotificationContent.title,
        message: customerNotificationContent.message,
        status: initialStatus,
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
      
      await db.collection("notifications").add(customerNotificationPayload);
    } catch (notifError) {
      // Log error but don't fail the booking creation
      console.error("Error creating customer notification:", notifError);
    }
    
    // Send notifications based on staff assignments
    // - Notify assigned staff directly
    // - If any services need assignment, notify admin too
    
    if (staffAnalysis.hasAnyAssignedStaff) {
      // Send notifications to staff who have assignments
      try {
        const staffToNotify: Array<{ uid: string; name: string }> = [];
        
        // Collect staff members to notify from services
        if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
          for (const svc of processedServices) {
            if (isValidStaffAssignment(svc.staffId)) {
              const existing = staffToNotify.find(s => s.uid === svc.staffId);
              if (!existing) {
                staffToNotify.push({ uid: svc.staffId!, name: svc.staffName || "Staff" });
              }
            }
          }
        } else if (isValidStaffAssignment(body.staffId)) {
          // Single staff assignment
          staffToNotify.push({ uid: body.staffId!, name: body.staffName || "Staff" });
        }
        
        // Send notification to each staff member
        for (const staff of staffToNotify) {
          await createStaffAssignmentNotification(db, {
            bookingId: ref.id,
            bookingCode: bookingCode,
            staffUid: staff.uid,
            staffName: staff.name,
            clientName: String(body.client),
            clientPhone: body.clientPhone,
            serviceName: body.serviceName,
            services: processedServices?.map(s => ({
              name: s.name || "Service",
              staffName: s.staffName || undefined,
              staffId: s.staffId || undefined,
            })),
            branchName: body.branchName,
            bookingDate: String(body.date),
            bookingTime: String(body.time),
            duration: Number(body.duration),
            price: Number(body.price),
            ownerUid: String(body.ownerUid),
          });
        }
        
        console.log(`✅ Booking ${bookingCode}: Sent notifications to ${staffToNotify.length} assigned staff member(s)`);
      } catch (staffNotifError) {
        console.error("Error creating staff notifications:", staffNotifError);
      }
    }
    
    // If any services need staff assignment, notify admin
    if (staffAnalysis.hasAnyUnassignedStaff) {
      try {
        // Create admin notification for partial assignment needed
        const unassignedServices = processedServices?.filter(s => !isValidStaffAssignment(s.staffId)) || [];
        const unassignedServiceNames = unassignedServices.map(s => s.name || "Service").join(", ");
        
        const adminNotificationPayload = {
          bookingId: ref.id,
          bookingCode: bookingCode,
          type: "booking_needs_assignment",
          title: staffAnalysis.noneAssigned ? "New Booking - Staff Assignment Required" : "Booking - Partial Staff Assignment Required",
          message: staffAnalysis.noneAssigned 
            ? `New booking from ${body.client} for ${unassignedServiceNames} on ${body.date} at ${body.time}. Please assign staff to all services.`
            : `Booking from ${body.client} needs staff assignment for: ${unassignedServiceNames}. Other services have been sent to assigned staff.`,
          status: initialStatus,
          ownerUid: String(body.ownerUid),
          // Target admin/owner
          targetRole: "admin",
          clientName: String(body.client),
          clientPhone: body.clientPhone || null,
          serviceName: body.serviceName || null,
          services: processedServices?.map(s => ({
            name: s.name || "Service",
            staffName: s.staffName || "Needs Assignment",
            staffId: s.staffId || null,
            needsAssignment: !isValidStaffAssignment(s.staffId),
          })) || null,
          branchName: body.branchName || null,
          bookingDate: body.date || null,
          bookingTime: body.time || null,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        };
        
        await db.collection("notifications").add(adminNotificationPayload);
        
        console.log(`Booking ${bookingCode}: Admin notified - ${unassignedServices.length} service(s) need staff assignment`);
      } catch (adminNotifError) {
        console.error("Error creating admin notification:", adminNotifError);
      }
    } else {
      console.log(`Booking ${bookingCode}: All services have assigned staff - no admin notification needed`);
    }
    
    // Send notification to branch admin (if branch has an admin and admin is not the same as staff/owner)
    try {
      const branchAdminUid = await getBranchAdminUid(db, String(body.branchId));
      if (branchAdminUid && 
          branchAdminUid !== String(body.ownerUid) && 
          branchAdminUid !== body.staffId) {
        await createBranchAdminNotification(db, {
          bookingId: ref.id,
          bookingCode: bookingCode,
          branchId: String(body.branchId),
          branchAdminUid: branchAdminUid,
          clientName: String(body.client),
          clientPhone: body.clientPhone,
          serviceName: body.serviceName,
          services: processedServices?.map(s => ({
            name: s.name || "Service",
            staffName: s.staffName || undefined,
            staffId: s.staffId || undefined,
          })),
          branchName: body.branchName,
          bookingDate: String(body.date),
          bookingTime: String(body.time),
          duration: Number(body.duration),
          price: Number(body.price),
          ownerUid: String(body.ownerUid),
          status: initialStatus,
        });
        console.log(`✅ Booking ${bookingCode}: Branch admin ${branchAdminUid} notified`);
      }
    } catch (branchAdminError) {
      console.error("Error notifying branch admin:", branchAdminError);
    }
    
    // ALWAYS send notification to salon owner for every booking from booking engine
    try {
      await createOwnerNotification(db, {
        bookingId: ref.id,
        bookingCode: bookingCode,
        ownerUid: String(body.ownerUid),
        clientName: String(body.client),
        clientPhone: body.clientPhone,
        serviceName: body.serviceName,
        services: processedServices?.map(s => ({
          name: s.name || "Service",
          staffName: s.staffName || undefined,
          staffId: s.staffId || undefined,
        })),
        branchName: body.branchName,
        bookingDate: String(body.date),
        bookingTime: String(body.time),
        duration: Number(body.duration),
        price: Number(body.price),
        status: initialStatus,
      });
      console.log(`✅ Booking ${bookingCode}: Salon owner ${body.ownerUid} notified`);
    } catch (ownerNotifError) {
      console.error("Error notifying salon owner:", ownerNotifError);
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

