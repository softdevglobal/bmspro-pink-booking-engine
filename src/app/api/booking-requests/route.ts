import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { Message } from "firebase-admin/messaging";
import { generateBookingCode } from "@/lib/bookings";
import { getNotificationContent } from "@/lib/notifications";
import { shouldBlockSlots } from "@/lib/bookingTypes";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";
import { validateOwnerUid } from "@/lib/ownerValidation";
import { sendBookingRequestReceivedEmail } from "@/lib/emailService";

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
 * Check if a staff ID represents "Any Staff" (unassigned)
 */
function isAnyStaff(staffId?: string | null): boolean {
  if (!staffId) return true; // null, undefined, or empty
  const str = String(staffId).trim().toLowerCase();
  return str === "" || str === "null" || str.includes("any");
}

/**
 * Check if a booking has "Any Staff" assignments
 * This checks both staffId and staffName for "Any Staff" indicators
 */
function hasAnyStaffBooking(
  services?: Array<{ staffId?: string | null; staffName?: string | null }> | null,
  staffId?: string | null,
  staffName?: string | null
): boolean {
  // Check services array for multi-service bookings
  if (services && Array.isArray(services) && services.length > 0) {
    return services.some(s => {
      // Check both staffId and staffName for "Any Staff" indicators
      const hasAnyStaffId = isAnyStaff(s.staffId);
      const hasAnyStaffName = !!(s.staffName && (
        s.staffName.toLowerCase().includes("any available") ||
        s.staffName.toLowerCase().includes("any staff") ||
        s.staffName.toLowerCase() === "any"
      ));
      return hasAnyStaffId || hasAnyStaffName;
    });
  }
  // Single service booking - check both staffId and staffName
  const hasAnyStaffId = isAnyStaff(staffId);
  const hasAnyStaffName = !!(staffName && (
    staffName.toLowerCase().includes("any available") ||
    staffName.toLowerCase().includes("any staff") ||
    staffName.toLowerCase() === "any"
  ));
  return hasAnyStaffId || hasAnyStaffName;
}

/**
 * Analyze staff assignments in a booking
 * Returns details about which services have staff and which don't
 */
function analyzeStaffAssignments(
  services?: Array<{ staffId?: string | null; staffName?: string | null }>,
  staffId?: string | null,
  staffName?: string | null
): { 
  hasAnyAssignedStaff: boolean;  // At least one service has staff
  hasAnyUnassignedStaff: boolean;  // At least one service needs staff assignment
  allAssigned: boolean;  // All services have staff
  noneAssigned: boolean;  // No services have staff
} {
  // Check services array for multi-service bookings
  if (services && Array.isArray(services) && services.length > 0) {
    const assignedCount = services.filter(s => {
      // Check both staffId and staffName - if either indicates "any staff", it's unassigned
      const isAnyStaffId = isAnyStaff(s.staffId);
      const isAnyStaffName = !!(s.staffName && (
        s.staffName.toLowerCase().includes("any available") ||
        s.staffName.toLowerCase().includes("any staff") ||
        s.staffName.toLowerCase() === "any"
      ));
      return !isAnyStaffId && !isAnyStaffName;
    }).length;
    const totalCount = services.length;
    
    return {
      hasAnyAssignedStaff: assignedCount > 0,
      hasAnyUnassignedStaff: assignedCount < totalCount,
      allAssigned: assignedCount === totalCount,
      noneAssigned: assignedCount === 0,
    };
  }
  
  // Single service booking - check both staffId and staffName
  const isAnyStaffId = isAnyStaff(staffId);
  const isAnyStaffName = !!(staffName && (
    staffName.toLowerCase().includes("any available") ||
    staffName.toLowerCase().includes("any staff") ||
    staffName.toLowerCase() === "any"
  ));
  const isAssigned = !isAnyStaffId && !isAnyStaffName;
  
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
        ttl: 86400000, // 24 hours in milliseconds
        notification: {
          sound: "default",
          channelId: "appointments",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        headers: {
          "apns-priority": "10", // High priority for immediate delivery
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: "default",
            badge: 1,
            "content-available": 1, // Wake up app in background
            "mutable-content": 1,   // Allow notification modification
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
 * Get all branch admin UIDs for a branch
 * Branch admins are stored in the users collection with role='salon_branch_admin' and matching branchId
 */
async function getBranchAdminUids(db: FirebaseFirestore.Firestore, branchId: string, ownerUid: string): Promise<string[]> {
  try {
    // First, try to get branch document to get ownerUid if not provided
    let actualOwnerUid = ownerUid;
    if (!actualOwnerUid) {
      const branchDoc = await db.collection("branches").doc(branchId).get();
      if (branchDoc.exists) {
        const branchData = branchDoc.data();
        actualOwnerUid = branchData?.ownerUid || ownerUid;
      }
    }
    
    // Query users collection for branch admins
    // Branch admins have: role='salon_branch_admin', ownerUid matches, and branchId matches
    const branchAdminQuery = await db.collection("users")
      .where("ownerUid", "==", actualOwnerUid)
      .where("role", "==", "salon_branch_admin")
      .where("branchId", "==", branchId)
      .get();
    
    const branchAdminUids = branchAdminQuery.docs.map(doc => doc.id);
    
    // Also check legacy adminStaffId in branch document (for backward compatibility)
    if (branchAdminUids.length === 0) {
      const branchDoc = await db.collection("branches").doc(branchId).get();
      if (branchDoc.exists) {
        const branchData = branchDoc.data();
        if (branchData?.adminStaffId) {
          return [branchData.adminStaffId];
        }
      }
    }
    
    return branchAdminUids;
  } catch (error) {
    console.error("Error getting branch admins:", error);
    return [];
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
  branchId?: string;
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
    branchId: data.branchId || null, // Include branchId for branch admin filtering
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
  sessionId?: string; // Browser session ID for slot hold management
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

    // Session ID from the booking request (used for slot hold identification)
    const sessionId = body.sessionId || null;

    // Check for existing bookings that would conflict
    try {
      // Query bookings for the same date, and also query active slot holds
      const bookingsQuery = db.collection("bookings")
        .where("ownerUid", "==", String(body.ownerUid))
        .where("date", "==", dateStr);
      
      const bookingRequestsQuery = db.collection("bookingRequests")
        .where("ownerUid", "==", String(body.ownerUid))
        .where("date", "==", dateStr);

      const slotHoldsQuery = db.collection("slotHolds")
        .where("ownerUid", "==", String(body.ownerUid))
        .where("date", "==", dateStr)
        .where("status", "==", "active");

      const [bookingsSnapshot, bookingRequestsSnapshot, slotHoldsSnapshot] = await Promise.all([
        bookingsQuery.get().catch(() => ({ docs: [] })),
        bookingRequestsQuery.get().catch(() => ({ docs: [] })),
        slotHoldsQuery.get().catch(() => ({ docs: [] as any[] })),
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

      // For "Any Staff" bookings, we need to check if ALL eligible staff are booked
      // (not just if any single booking conflicts). Pre-fetch staff/service data if needed.
      const hasAnyStaffService = servicesToCheck.some(s => !isValidStaffAssignment(s.staffId || body.staffId));
      let eligibleStaffByService: Record<string, string[]> = {};

      if (hasAnyStaffService) {
        // Fetch staff and service data to determine eligible staff per service
        const [staffSnapshot, servicesSnapshot] = await Promise.all([
          db.collection("users")
            .where("ownerUid", "==", String(body.ownerUid))
            .get()
            .catch(() => ({ docs: [] as any[] })),
          db.collection("services")
            .where("ownerUid", "==", String(body.ownerUid))
            .get()
            .catch(() => ({ docs: [] as any[] }))
        ]);

        const allStaff = (staffSnapshot.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));
        const allServices = (servicesSnapshot.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));

        for (const svc of servicesToCheck) {
          const svcStaffId = svc.staffId || body.staffId;
          if (isValidStaffAssignment(svcStaffId)) continue; // Skip specific staff services

          const serviceId = svc.id || svc.serviceId || body.serviceId;
          const serviceData = allServices.find((s: any) => String(s.id) === String(serviceId));

          const eligible = allStaff.filter((st: any) => {
            const role = (st.role || "").toString().toLowerCase();
            if (role !== "salon_staff" && role !== "salon_branch_admin") return false;
            if (st.status && st.status !== "Active") return false;

            // Check service capability
            if (serviceData?.staffIds && serviceData.staffIds.length > 0) {
              const canPerform = serviceData.staffIds.some((id: string) =>
                String(id) === st.id || String(id) === (st.uid || st.id)
              );
              if (!canPerform) return false;
            }

            // Check branch assignment
            return st.branchId === String(body.branchId);
          });

          eligibleStaffByService[String(serviceId)] = eligible.map((s: any) => s.id);
        }
      }

      for (const newService of servicesToCheck) {
        const newServiceTime = newService.time || body.time;
        const newServiceDuration = newService.duration || body.duration;
        const newServiceStaffId = newService.staffId || body.staffId || null;

        if (!newServiceTime) continue;

        const newStartMinutes = timeToMinutes(newServiceTime);
        const newEndMinutes = newStartMinutes + newServiceDuration;
        const newHasStaff = isValidStaffAssignment(newServiceStaffId);

        if (!newHasStaff) {
          // ── "Any Staff" mode ──
          // Instead of blocking on the first conflict, aggregate which eligible staff
          // are booked and only reject if ALL of them are occupied at this time.
          const serviceId = newService.id || newService.serviceId || body.serviceId;
          const eligibleIds = eligibleStaffByService[String(serviceId)] || [];

          if (eligibleIds.length === 0) {
            // No eligible staff data available – skip validation (can't determine)
            continue;
          }

          // Collect staff IDs that have overlapping bookings
          const bookedStaffIds = new Set<string>();
          // Also count existing "Any Staff" bookings that overlap (each consumes one staff slot)
          let anyStaffBookingsOverlapping = 0;

          for (const existingBooking of allExistingBookings) {
            if (!isActiveStatus(existingBooking.status)) continue;

            if (existingBooking.services && Array.isArray(existingBooking.services) && existingBooking.services.length > 0) {
              for (const existingService of existingBooking.services) {
                if (!existingService.time) continue;
                const existingServiceStaffId = existingService.staffId || existingBooking.staffId || null;
                const existingStartMinutes = timeToMinutes(existingService.time);
                const existingDuration = existingService.duration || existingBooking.duration || 60;
                const existingEndMinutes = existingStartMinutes + existingDuration;

                if (!timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) continue;

                if (isValidStaffAssignment(existingServiceStaffId)) {
                  // Existing booking has a specific staff – mark that staff as busy
                  if (eligibleIds.includes(existingServiceStaffId!)) {
                    bookedStaffIds.add(existingServiceStaffId!);
                  }
                } else {
                  // Existing booking is also "Any Staff" – it will consume one staff slot
                  anyStaffBookingsOverlapping++;
                }
              }
            } else {
              if (!existingBooking.time) continue;
              const existingStaffId = existingBooking.staffId || null;
              const existingStartMinutes = timeToMinutes(existingBooking.time);
              const existingDuration = existingBooking.duration || 60;
              const existingEndMinutes = existingStartMinutes + existingDuration;

              if (!timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) continue;

              if (isValidStaffAssignment(existingStaffId)) {
                if (eligibleIds.includes(existingStaffId!)) {
                  bookedStaffIds.add(existingStaffId!);
                }
              } else {
                anyStaffBookingsOverlapping++;
              }
            }
          }

          // Available = eligible staff not specifically booked, minus slots consumed by existing "Any Staff" bookings
          const freeStaff = eligibleIds.length - bookedStaffIds.size - anyStaffBookingsOverlapping;

          if (freeStaff <= 0) {
            console.log(`[BOOKING CONFLICT] All ${eligibleIds.length} eligible staff are booked at ${newServiceTime} (${bookedStaffIds.size} specific + ${anyStaffBookingsOverlapping} any-staff bookings)`);
            return NextResponse.json(
              {
                error: "Time slot fully booked",
                details: `All available staff members are booked at ${newServiceTime}. Please choose a different time.`,
              },
              { status: 409 }
            );
          }

          // This "Any Staff" service passed validation
          continue;
        }

        // ── Specific staff mode ──
        // Check against all existing bookings for the same specific staff
        for (const existingBooking of allExistingBookings) {
          // Skip if booking is not active
          if (!isActiveStatus(existingBooking.status)) continue;

          // Check if this is a multi-service booking
          if (existingBooking.services && Array.isArray(existingBooking.services) && existingBooking.services.length > 0) {
            // Check each service in the existing booking
            for (const existingService of existingBooking.services) {
              if (!existingService.time) continue;
              
              const existingServiceStaffId = existingService.staffId || existingBooking.staffId || null;
              const existingHasStaff = isValidStaffAssignment(existingServiceStaffId);
              
              // Only conflict if same specific staff, or existing is "any staff" (blocks the pool)
              const shouldCheckConflict =
                (existingHasStaff && newServiceStaffId === existingServiceStaffId) ||
                (!existingHasStaff); // Existing "any staff" could be assigned to our staff
              
              if (!shouldCheckConflict) continue;

              const existingStartMinutes = timeToMinutes(existingService.time);
              const existingDuration = existingService.duration || existingBooking.duration || 60;
              const existingEndMinutes = existingStartMinutes + existingDuration;

              // Check for overlap
              if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
                const conflictDetails = {
                  newService: {
                    time: newServiceTime,
                    duration: newServiceDuration,
                    staffId: newServiceStaffId,
                    staffType: "specific"
                  },
                  existingService: {
                    time: existingService.time,
                    duration: existingDuration,
                    staffId: existingServiceStaffId,
                    staffType: existingHasStaff ? "specific" : "any available",
                    bookingId: existingBooking.id,
                    bookingCode: existingBooking.bookingCode
                  }
                };
                console.log("[BOOKING CONFLICT] Time slot conflict detected:", conflictDetails);
                
                return NextResponse.json(
                  { 
                    error: "Time slot already booked",
                    details: `The selected time ${newServiceTime} conflicts with an existing booking${existingBooking.bookingCode ? ` (${existingBooking.bookingCode})` : ''}. Please choose a different time.`,
                    conflictInfo: conflictDetails
                  },
                  { status: 409 } // 409 Conflict
                );
              }
            }
          } else {
            // Single-service booking
            if (!existingBooking.time) continue;

            const existingStaffId = existingBooking.staffId || null;
            const existingHasStaff = isValidStaffAssignment(existingStaffId);
            
            // Only conflict if same specific staff, or existing is "any staff"
            const shouldCheckConflict =
              (existingHasStaff && newServiceStaffId === existingStaffId) ||
              (!existingHasStaff);
            
            if (!shouldCheckConflict) continue;

            const existingStartMinutes = timeToMinutes(existingBooking.time);
            const existingDuration = existingBooking.duration || 60;
            const existingEndMinutes = existingStartMinutes + existingDuration;

            // Check for overlap
            if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
              const conflictDetails = {
                newService: {
                  time: newServiceTime,
                  duration: newServiceDuration,
                  staffId: newServiceStaffId,
                  staffType: "specific"
                },
                existingBooking: {
                  time: existingBooking.time,
                  duration: existingDuration,
                  staffId: existingStaffId,
                  staffType: existingHasStaff ? "specific" : "any available",
                  bookingId: existingBooking.id,
                  bookingCode: existingBooking.bookingCode
                }
              };
              console.log("[BOOKING CONFLICT] Time slot conflict detected:", conflictDetails);
              
              return NextResponse.json(
                { 
                  error: "Time slot already booked",
                  details: `The selected time ${newServiceTime} conflicts with an existing booking${existingBooking.bookingCode ? ` (${existingBooking.bookingCode})` : ''}. Please choose a different time.`,
                  conflictInfo: conflictDetails
                },
                { status: 409 } // 409 Conflict
              );
            }
          }
        }
      }
      // --- Also check active slot holds from OTHER sessions ---
      const now = Date.now();
      const activeOtherHolds = (slotHoldsSnapshot.docs || [])
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((h: any) => h.sessionId !== sessionId && h.expiresAt > now);

      for (const newService of servicesToCheck) {
        const newServiceTime = newService.time || body.time;
        const newServiceDuration = newService.duration || body.duration;
        const newServiceStaffId = newService.staffId || body.staffId || null;

        if (!newServiceTime) continue;

        const newStartMinutes = timeToMinutes(newServiceTime);
        const newEndMinutes = newStartMinutes + newServiceDuration;
        const newHasStaff = isValidStaffAssignment(newServiceStaffId);

        for (const hold of activeOtherHolds) {
          if (!Array.isArray(hold.services)) continue;
          for (const holdSvc of hold.services) {
            if (!holdSvc.time) continue;
            const holdStaffId = holdSvc.staffId || null;
            const holdHasStaff = isValidStaffAssignment(holdStaffId);

            // Only conflict if same staff (or either is "any staff")
            if (newHasStaff && holdHasStaff && newServiceStaffId !== holdStaffId) continue;

            const holdStart = timeToMinutes(holdSvc.time);
            const holdEnd = holdStart + (holdSvc.duration || 60);

            if (timeRangesOverlap(newStartMinutes, newEndMinutes, holdStart, holdEnd)) {
              console.log(`[BOOKING CONFLICT] Slot held by another customer (hold: ${hold.id}, session: ${hold.sessionId})`);
              return NextResponse.json(
                {
                  error: "Time slot is temporarily reserved",
                  details: `${newServiceTime} is being held by another customer. Please wait or choose a different time.`,
                },
                { status: 409 }
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
    const staffAnalysis = analyzeStaffAssignments(body.services, body.staffId, body.staffName);
    
    // Check if this is an "Any Staff" booking (needs staff assignment)
    const hasAnyStaff = hasAnyStaffBooking(body.services, body.staffId, body.staffName);
    console.log(`📋 Booking ${bookingCode}: Checking for Any Staff booking - hasAnyStaff: ${hasAnyStaff}, staffId: ${body.staffId}, staffName: ${body.staffName}, processedServices: ${JSON.stringify(body.services?.map(s => ({ name: s.name, staffId: s.staffId, staffName: s.staffName })))}`);
    
    // Initialize services with approval status
    let processedServices = body.services || null;
    if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
      processedServices = processedServices.map(service => {
        // Check both staffId and staffName to determine if staff is assigned
        const isAnyStaffId = isAnyStaff(service.staffId);
        const isAnyStaffName = !!(service.staffName && (
          service.staffName.toLowerCase().includes("any available") ||
          service.staffName.toLowerCase().includes("any staff") ||
          service.staffName.toLowerCase() === "any"
        ));
        const hasAssignedStaff = !isAnyStaffId && !isAnyStaffName;
        
        return {
          ...service,
          // Services with valid staff get "pending" approval status
          // Services without staff (Any Available) get "needs_assignment" status
          approvalStatus: hasAssignedStaff ? "pending" : "needs_assignment",
        };
      });
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

    // ─── ATOMIC SLOT LOCK ───
    // Use deterministic lock document IDs to prevent double-booking.
    // Firestore's create() fails if the document already exists, so only the
    // first request to reach this point will succeed — the second gets a 409.
    const lockIds: string[] = [];
    const svcList: Array<any> = (processedServices && Array.isArray(processedServices) && processedServices.length > 0)
      ? processedServices
      : [{ staffId: body.staffId || null, time: body.time, duration: body.duration }];

    for (const svc of svcList) {
      const svcStaffId = svc.staffId || body.staffId || "any";
      const svcTime = svc.time || body.time;
      if (!svcTime) continue;
      // Deterministic ID: ownerUid_date_staffId_time (e.g. "abc123_2026-02-10_staffXYZ_09:00")
      const lockId = `${String(body.ownerUid)}_${dateStr}_${svcStaffId}_${svcTime}`;
      lockIds.push(lockId);
    }

    // Try to acquire all locks atomically
    const acquiredLocks: string[] = [];
    try {
      for (const lockId of lockIds) {
        const lockRef = db.collection("bookingSlotLocks").doc(lockId);
        try {
          await lockRef.create({
            ownerUid: String(body.ownerUid),
            date: dateStr,
            bookingCode,
            createdAt: Date.now(),
            // Auto-expire after 10 minutes (cleanup safety net)
            expiresAt: Date.now() + 10 * 60 * 1000,
          });
          acquiredLocks.push(lockId);
        } catch (lockError: any) {
          // ALREADY_EXISTS means another booking grabbed this slot first
          if (lockError.code === 6 || lockError.code === "already-exists" ||
              lockError.message?.includes("ALREADY_EXISTS") || lockError.message?.includes("already exists")) {
            // Release any locks we already acquired
            for (const acquired of acquiredLocks) {
              await db.collection("bookingSlotLocks").doc(acquired).delete().catch(() => {});
            }
            console.log(`[BOOKING CONFLICT] Atomic lock failed for slot: ${lockId}`);
            return NextResponse.json(
              {
                error: "Time slot already booked",
                details: "Another customer just booked this slot. Please go back and choose a different time.",
              },
              { status: 409 }
            );
          }
          throw lockError; // Re-throw unexpected errors
        }
      }
    } catch (lockErr: any) {
      // Clean up any acquired locks on unexpected error
      for (const acquired of acquiredLocks) {
        await db.collection("bookingSlotLocks").doc(acquired).delete().catch(() => {});
      }
      throw lockErr;
    }

    // Lock acquired — safe to create the booking
    const ref = await db.collection("bookings").add(payload);

    // Update lock documents with the booking ID for traceability
    for (const lockId of acquiredLocks) {
      await db.collection("bookingSlotLocks").doc(lockId).update({ bookingId: ref.id }).catch(() => {});
    }
    
    // Send email to customer when booking is created (Request Received)
    try {
      await sendBookingRequestReceivedEmail(
        ref.id,
        bookingCode,
        body.clientEmail || null,
        String(body.client),
        String(body.ownerUid),
        {
          branchName: body.branchName || null,
          bookingDate: String(body.date),
          bookingTime: String(body.time),
          duration: Number(body.duration) || null,
          price: Number(body.price) || null,
          serviceName: body.serviceName || null,
          services: processedServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName || null,
            time: s.time || String(body.time),
            duration: s.duration || Number(body.duration) || null,
          })),
          staffName: body.staffName || null,
        }
      );
    } catch (emailError) {
      console.error("Failed to send booking request received email:", emailError);
      // Don't fail the request if email sending fails
    }
    
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
      
      const customerNotifRef = await db.collection("notifications").add(customerNotificationPayload);
      
      // Send FCM push notification to customer if they have a customerUid
      if (body.customerUid) {
        try {
          const customerFcmToken = await getUserFcmToken(db, body.customerUid);
          if (customerFcmToken) {
            console.log(`📱 Booking ${bookingCode}: Found FCM token for customer ${body.customerUid}, sending push notification...`);
            await sendPushNotification(customerFcmToken, customerNotificationContent.title, customerNotificationContent.message, {
              notificationId: customerNotifRef.id,
              type: customerNotificationContent.type,
              bookingId: ref.id,
              bookingCode: bookingCode || "",
            });
            console.log(`✅ Booking ${bookingCode}: FCM push sent to customer ${body.customerUid}`);
          } else {
            console.log(`⚠️ Booking ${bookingCode}: No FCM token found for customer ${body.customerUid}, skipping push notification`);
            console.log(`⚠️ Booking ${bookingCode}: Notification was still created in Firestore (ID: ${customerNotifRef.id}) - mobile app will receive it when it syncs`);
          }
        } catch (fcmError) {
          // Don't fail if FCM push fails - notification is already in Firestore
          console.error(`⚠️ Booking ${bookingCode}: FCM push failed for customer ${body.customerUid}, but notification was created:`, fcmError);
          console.log(`⚠️ Booking ${bookingCode}: Notification is available in Firestore (ID: ${customerNotifRef.id}) - mobile app will receive it when it syncs`);
        }
      } else {
        console.log(`ℹ️ Booking ${bookingCode}: No customerUid provided - notification created but no push sent`);
      }
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
    
    // If any services need staff assignment, notify admin (owner and branch admins)
    // CRITICAL: Also check hasAnyStaff to ensure we catch all "Any Staff" bookings
    if (staffAnalysis.hasAnyUnassignedStaff || hasAnyStaff) {
      try {
        console.log(`📋 Booking ${bookingCode}: Detected unassigned staff - hasAnyUnassignedStaff: ${staffAnalysis.hasAnyUnassignedStaff}, noneAssigned: ${staffAnalysis.noneAssigned}`);
        
        // Create admin notification for partial assignment needed
        // Check both staffId and staffName to identify unassigned services
        const unassignedServices = processedServices?.filter(s => {
          const isAnyStaffId = isAnyStaff(s.staffId);
          const isAnyStaffName = !!(s.staffName && (
            s.staffName.toLowerCase().includes("any available") ||
            s.staffName.toLowerCase().includes("any staff") ||
            s.staffName.toLowerCase() === "any"
          ));
          return isAnyStaffId || isAnyStaffName;
        }) || [];
        const unassignedServiceNames = unassignedServices.map(s => s.name || "Service").join(", ");
        
        const title = staffAnalysis.noneAssigned 
          ? "New Booking - Staff Assignment Required" 
          : "Booking - Partial Staff Assignment Required";
        const message = staffAnalysis.noneAssigned 
          ? `New booking from ${body.client} for ${unassignedServiceNames} on ${body.date} at ${body.time}. Please assign staff to all services.`
          : `Booking from ${body.client} needs staff assignment for: ${unassignedServiceNames}. Other services have been sent to assigned staff.`;
        
        console.log(`📋 Booking ${bookingCode}: Creating notification for owner ${body.ownerUid} - Title: "${title}"`);
        
        // Notify salon owner
        const adminNotificationPayload = {
          bookingId: ref.id,
          bookingCode: bookingCode,
          type: "booking_needs_assignment",
          title,
          message,
          status: initialStatus,
          ownerUid: String(body.ownerUid),
          targetOwnerUid: String(body.ownerUid), // Target owner for unassigned bookings
          // Target admin/owner
          targetRole: "admin",
          clientName: String(body.client),
          clientPhone: body.clientPhone || null,
          serviceName: body.serviceName || null,
          services: processedServices?.map(s => ({
            name: s.name || "Service",
            staffName: s.staffName || "Needs Assignment",
            staffId: s.staffId || null,
            needsAssignment: (() => {
              const isAnyStaffId = isAnyStaff(s.staffId);
              const isAnyStaffName = !!(s.staffName && (
                s.staffName.toLowerCase().includes("any available") ||
                s.staffName.toLowerCase().includes("any staff") ||
                s.staffName.toLowerCase() === "any"
              ));
              return isAnyStaffId || isAnyStaffName;
            })(),
          })) || null,
          branchName: body.branchName || null,
          branchId: body.branchId ? String(body.branchId) : null, // Include branchId for branch admin filtering
          bookingDate: body.date || null,
          bookingTime: body.time || null,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        };
        
        const notifRef = await db.collection("notifications").add(adminNotificationPayload);
        console.log(`✅ Booking ${bookingCode}: Notification created in Firestore with ID: ${notifRef.id}`);
        
        // Send FCM push notification to owner for unassigned bookings
        const ownerFcmToken = await getUserFcmToken(db, String(body.ownerUid));
        if (ownerFcmToken) {
          console.log(`📱 Booking ${bookingCode}: Found FCM token for owner ${body.ownerUid}, sending push notification...`);
          await sendPushNotification(ownerFcmToken, title, message, {
            notificationId: notifRef.id,
            type: "booking_needs_assignment",
            bookingId: ref.id,
            bookingCode: bookingCode || "",
          });
          console.log(`✅ Booking ${bookingCode}: FCM push sent to owner ${body.ownerUid} for unassigned booking`);
        } else {
          console.log(`⚠️ Booking ${bookingCode}: No FCM token found for owner ${body.ownerUid}, skipping push notification`);
          console.log(`⚠️ Booking ${bookingCode}: Notification was still created in Firestore (ID: ${notifRef.id}) - mobile app will receive it when it syncs`);
        }
        
        // Also notify all branch admins for this branch about the unassigned booking
        const branchAdminUids = await getBranchAdminUids(db, String(body.branchId), String(body.ownerUid));
        console.log(`📋 Booking ${bookingCode}: Found ${branchAdminUids.length} branch admin(s) for branch ${body.branchId}`);
        
        for (const branchAdminUid of branchAdminUids) {
          // Skip if branch admin is the owner or the assigned staff
          if (branchAdminUid === String(body.ownerUid) || branchAdminUid === body.staffId) {
            console.log(`⏭️ Booking ${bookingCode}: Skipping branch admin ${branchAdminUid} (is owner or assigned staff)`);
            continue;
          }
          
          console.log(`📋 Booking ${bookingCode}: Creating notification for branch admin ${branchAdminUid}`);
          
          // Create notification for branch admin
          const branchAdminNotificationPayload = {
            bookingId: ref.id,
            bookingCode: bookingCode,
            type: "booking_needs_assignment",
            title,
            message,
            status: initialStatus,
            ownerUid: String(body.ownerUid),
            branchAdminUid: branchAdminUid,
            targetAdminUid: branchAdminUid, // Target branch admin
            targetRole: "admin",
            clientName: String(body.client),
            clientPhone: body.clientPhone || null,
            serviceName: body.serviceName || null,
            services: processedServices?.map(s => ({
              name: s.name || "Service",
              staffName: s.staffName || "Needs Assignment",
              staffId: s.staffId || null,
              needsAssignment: (() => {
              const isAnyStaffId = isAnyStaff(s.staffId);
              const isAnyStaffName = !!(s.staffName && (
                s.staffName.toLowerCase().includes("any available") ||
                s.staffName.toLowerCase().includes("any staff") ||
                s.staffName.toLowerCase() === "any"
              ));
              return isAnyStaffId || isAnyStaffName;
            })(),
            })) || null,
            branchName: body.branchName || null,
            branchId: body.branchId ? String(body.branchId) : null,
            bookingDate: body.date || null,
            bookingTime: body.time || null,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          };
          
          const branchAdminNotifRef = await db.collection("notifications").add(branchAdminNotificationPayload);
          console.log(`✅ Booking ${bookingCode}: Branch admin notification created in Firestore with ID: ${branchAdminNotifRef.id}`);
          
          // Send FCM push notification to branch admin
          const branchAdminFcmToken = await getUserFcmToken(db, branchAdminUid);
          if (branchAdminFcmToken) {
            console.log(`📱 Booking ${bookingCode}: Found FCM token for branch admin ${branchAdminUid}, sending push notification...`);
            await sendPushNotification(branchAdminFcmToken, title, message, {
              notificationId: branchAdminNotifRef.id,
              type: "booking_needs_assignment",
              bookingId: ref.id,
              bookingCode: bookingCode || "",
            });
            console.log(`✅ Booking ${bookingCode}: FCM push sent to branch admin ${branchAdminUid} for unassigned booking`);
          } else {
            console.log(`⚠️ Booking ${bookingCode}: No FCM token found for branch admin ${branchAdminUid}, skipping push notification`);
            console.log(`⚠️ Booking ${bookingCode}: Notification was still created in Firestore (ID: ${branchAdminNotifRef.id}) - mobile app will receive it when it syncs`);
          }
        }
        
        console.log(`✅ Booking ${bookingCode}: Owner and ${branchAdminUids.length} branch admin(s) notified - ${unassignedServices.length} service(s) need staff assignment`);
      } catch (adminNotifError) {
        console.error("Error creating admin notification:", adminNotifError);
      }
    } else {
      console.log(`Booking ${bookingCode}: All services have assigned staff - no admin notification needed`);
    }
    
    // CRITICAL: ALWAYS notify branch admins for "Any Staff" bookings, even if hasAnyUnassignedStaff was false
    // This ensures branch admins receive notifications for ALL "Any Staff" bookings
    if (hasAnyStaff && !staffAnalysis.hasAnyUnassignedStaff) {
      try {
        console.log(`📋 Booking ${bookingCode}: Detected Any Staff booking (but hasAnyUnassignedStaff was false) - explicitly notifying branch admins`);
        
        const serviceList = processedServices && Array.isArray(processedServices) && processedServices.length > 0
          ? processedServices.map(s => s.name || "Service").join(", ")
          : body.serviceName || "Service";
        
        const title = "New Booking - Staff Assignment Required";
        const message = `New booking from ${body.client} for ${serviceList} on ${body.date} at ${body.time}. Please assign staff.`;
        
        // Notify all branch admins for this branch
        const branchAdminUids = await getBranchAdminUids(db, String(body.branchId), String(body.ownerUid));
        console.log(`📋 Booking ${bookingCode}: Found ${branchAdminUids.length} branch admin(s) for Any Staff booking`);
        
        for (const branchAdminUid of branchAdminUids) {
          // Skip if branch admin is the owner or the assigned staff
          if (branchAdminUid === String(body.ownerUid) || branchAdminUid === body.staffId) {
            console.log(`⏭️ Booking ${bookingCode}: Skipping branch admin ${branchAdminUid} (is owner or assigned staff)`);
            continue;
          }
          
          console.log(`📋 Booking ${bookingCode}: Creating notification for branch admin ${branchAdminUid} (Any Staff booking)`);
          
          // Create notification for branch admin
          const branchAdminNotificationPayload = {
            bookingId: ref.id,
            bookingCode: bookingCode,
            type: "booking_needs_assignment",
            title,
            message,
            status: initialStatus,
            ownerUid: String(body.ownerUid),
            branchAdminUid: branchAdminUid,
            targetAdminUid: branchAdminUid, // Target branch admin
            targetRole: "admin",
            clientName: String(body.client),
            clientPhone: body.clientPhone || null,
            serviceName: body.serviceName || null,
            services: processedServices?.map(s => ({
              name: s.name || "Service",
              staffName: s.staffName || "Needs Assignment",
              staffId: s.staffId || null,
              needsAssignment: (() => {
                const isAnyStaffId = isAnyStaff(s.staffId);
                const isAnyStaffName = !!(s.staffName && (
                  s.staffName.toLowerCase().includes("any available") ||
                  s.staffName.toLowerCase().includes("any staff") ||
                  s.staffName.toLowerCase() === "any"
                ));
                return isAnyStaffId || isAnyStaffName;
              })(),
            })) || null,
            branchName: body.branchName || null,
            branchId: body.branchId ? String(body.branchId) : null,
            bookingDate: body.date || null,
            bookingTime: body.time || null,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          };
          
          const branchAdminNotifRef = await db.collection("notifications").add(branchAdminNotificationPayload);
          console.log(`✅ Booking ${bookingCode}: Branch admin notification created in Firestore with ID: ${branchAdminNotifRef.id}`);
          
          // Send FCM push notification to branch admin
          const branchAdminFcmToken = await getUserFcmToken(db, branchAdminUid);
          if (branchAdminFcmToken) {
            console.log(`📱 Booking ${bookingCode}: Found FCM token for branch admin ${branchAdminUid}, sending push notification...`);
            await sendPushNotification(branchAdminFcmToken, title, message, {
              notificationId: branchAdminNotifRef.id,
              type: "booking_needs_assignment",
              bookingId: ref.id,
              bookingCode: bookingCode || "",
            });
            console.log(`✅ Booking ${bookingCode}: FCM push sent to branch admin ${branchAdminUid} for Any Staff booking`);
          } else {
            console.log(`⚠️ Booking ${bookingCode}: No FCM token found for branch admin ${branchAdminUid}, skipping push notification`);
            console.log(`⚠️ Booking ${bookingCode}: Notification was still created in Firestore (ID: ${branchAdminNotifRef.id}) - mobile app will receive it when it syncs`);
          }
        }
        
        if (branchAdminUids.length > 0) {
          console.log(`✅ Booking ${bookingCode}: Notified ${branchAdminUids.length} branch admin(s) for Any Staff booking`);
        } else {
          console.log(`⚠️ Booking ${bookingCode}: No branch admins found for branch ${body.branchId}`);
        }
      } catch (anyStaffNotifError) {
        console.error("❌ Failed to send branch admin notifications for Any Staff booking:", anyStaffNotifError);
        // Don't fail the request if notification sending fails
      }
    }
    
    // Send notification to all branch admins for this branch (for all bookings, not just unassigned)
    try {
      const branchAdminUids = await getBranchAdminUids(db, String(body.branchId), String(body.ownerUid));
      for (const branchAdminUid of branchAdminUids) {
        // Skip if branch admin is the owner or the assigned staff
        if (branchAdminUid === String(body.ownerUid) || branchAdminUid === body.staffId) {
          continue;
        }
        
        // Skip if we already notified this branch admin above (for unassigned bookings or Any Staff bookings)
        if (staffAnalysis.hasAnyUnassignedStaff || hasAnyStaff) {
          // Already notified in the unassigned booking section above
          continue;
        }
        
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
      
      if (branchAdminUids.length > 0) {
        console.log(`✅ Booking ${bookingCode}: Notified ${branchAdminUids.length} branch admin(s)`);
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
        branchId: body.branchId ? String(body.branchId) : undefined, // Include branchId for branch admin filtering
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
    
    // Release the slot hold for this session now that the booking is confirmed
    if (sessionId) {
      try {
        const holdsToRelease = await db.collection("slotHolds")
          .where("sessionId", "==", sessionId)
          .where("status", "==", "active")
          .get();
        if (holdsToRelease.size > 0) {
          const releaseBatch = db.batch();
          for (const holdDoc of holdsToRelease.docs) {
            releaseBatch.update(holdDoc.ref, { status: "converted", convertedToBookingId: ref.id, convertedAt: Date.now() });
          }
          await releaseBatch.commit();
          console.log(`🔓 Booking ${bookingCode}: Released ${holdsToRelease.size} slot hold(s) for session ${sessionId}`);
        }
      } catch (holdReleaseError) {
        console.error("Error releasing slot holds:", holdReleaseError);
        // Don't fail the booking if hold release fails
      }
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

