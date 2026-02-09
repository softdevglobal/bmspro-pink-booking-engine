import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { shouldBlockSlots } from "@/lib/bookingTypes";

export const runtime = "nodejs";

/**
 * Slot Hold duration in seconds (5 minutes).
 * After this time, the hold is considered expired and the slot becomes available.
 */
const HOLD_DURATION_SECONDS = 300;

/**
 * Maximum number of concurrent holds per session/client.
 * Prevents abuse where a single user locks up many slots.
 */
const MAX_HOLDS_PER_SESSION = 10;

/**
 * Check if a staff ID is a valid assigned staff (not "Any Available" or empty)
 */
function isValidStaffAssignment(staffId?: string | null): boolean {
  if (!staffId) return false;
  if (staffId === "null" || staffId === "") return false;
  if (staffId.toLowerCase().includes("any")) return false;
  return true;
}

/**
 * Helper function to check if two time ranges overlap
 */
function timeRangesOverlap(
  start1: number, end1: number,
  start2: number, end2: number
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Helper function to parse time string to minutes
 */
function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2) return 0;
  return parts[0] * 60 + parts[1];
}

/**
 * POST /api/slot-holds
 *
 * Create a temporary hold on one or more time slots.
 * The hold lasts for HOLD_DURATION_SECONDS and blocks other users from
 * selecting the same staff+time combination.
 *
 * Body:
 *   ownerUid:  string  (salon owner)
 *   branchId:  string
 *   date:      string  (YYYY-MM-DD)
 *   sessionId: string  (unique browser session identifier)
 *   services:  Array<{ serviceId, staffId?, time, duration }>
 *
 * Returns: { holdId, expiresAt }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    const { ownerUid, branchId, date, sessionId, services } = body;
    if (!ownerUid) return NextResponse.json({ error: "Missing ownerUid" }, { status: 400 });
    if (!branchId) return NextResponse.json({ error: "Missing branchId" }, { status: 400 });
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });
    if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    if (!services || !Array.isArray(services) || services.length === 0) {
      return NextResponse.json({ error: "Missing or empty services array" }, { status: 400 });
    }

    // Validate each service entry
    for (const svc of services) {
      if (!svc.time) return NextResponse.json({ error: "Each service must have a time" }, { status: 400 });
      if (!svc.duration) return NextResponse.json({ error: "Each service must have a duration" }, { status: 400 });
    }

    const db = adminDb();
    const now = Date.now();
    const expiresAt = now + HOLD_DURATION_SECONDS * 1000;

    // --- Abuse prevention: limit holds per session ---
    const existingHoldsQuery = await db.collection("slotHolds")
      .where("sessionId", "==", sessionId)
      .where("status", "==", "active")
      .get();

    // Filter out expired holds
    const activeHolds = existingHoldsQuery.docs.filter(doc => {
      const data = doc.data();
      return data.expiresAt && data.expiresAt > now;
    });

    if (activeHolds.length >= MAX_HOLDS_PER_SESSION) {
      return NextResponse.json(
        { error: "Too many active holds. Please release existing holds first." },
        { status: 429 }
      );
    }

    // --- Check for conflicts with existing bookings and active holds ---
    // Query existing bookings for the same date
    const [bookingsSnap, bookingRequestsSnap, holdsSnap] = await Promise.all([
      db.collection("bookings")
        .where("ownerUid", "==", String(ownerUid))
        .where("date", "==", String(date))
        .get()
        .catch(() => ({ docs: [] as any[] })),
      db.collection("bookingRequests")
        .where("ownerUid", "==", String(ownerUid))
        .where("date", "==", String(date))
        .get()
        .catch(() => ({ docs: [] as any[] })),
      db.collection("slotHolds")
        .where("ownerUid", "==", String(ownerUid))
        .where("date", "==", String(date))
        .where("status", "==", "active")
        .get()
        .catch(() => ({ docs: [] as any[] })),
    ]);

    // Combine bookings
    const allBookings = [
      ...bookingsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
      ...bookingRequestsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
    ];

    // Active holds from OTHER sessions (exclude our own session so re-selecting is OK)
    const otherActiveHolds = holdsSnap.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .filter((h: any) => h.sessionId !== sessionId && h.expiresAt > now);

    // ----- Pre-fetch eligible staff for "Any Staff" services -----
    const hasAnyStaffService = services.some((s: any) => !isValidStaffAssignment(s.staffId));
    let eligibleStaffByService: Record<string, string[]> = {};

    if (hasAnyStaffService) {
      const [staffSnapshot, servicesSnapshot] = await Promise.all([
        db.collection("users")
          .where("ownerUid", "==", String(ownerUid))
          .get()
          .catch(() => ({ docs: [] as any[] })),
        db.collection("services")
          .where("ownerUid", "==", String(ownerUid))
          .get()
          .catch(() => ({ docs: [] as any[] })),
      ]);

      const allStaff = (staffSnapshot.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));
      const allServicesData = (servicesSnapshot.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));

      for (const svc of services) {
        if (isValidStaffAssignment(svc.staffId)) continue;

        const serviceId = svc.serviceId;
        const serviceData = allServicesData.find((s: any) => String(s.id) === String(serviceId));

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
          return st.branchId === String(branchId);
        });

        eligibleStaffByService[String(serviceId)] = eligible.map((s: any) => s.id);
      }
    }

    // Check each service for conflicts
    for (const newSvc of services) {
      const newStart = timeToMinutes(newSvc.time);
      const newEnd = newStart + (newSvc.duration || 60);
      const newStaffId = newSvc.staffId || null;
      const hasSpecificStaff = isValidStaffAssignment(newStaffId);

      if (!hasSpecificStaff) {
        // ── "Any Staff" mode ──
        // Only block if ALL eligible staff are occupied at this time.
        const eligibleIds = eligibleStaffByService[String(newSvc.serviceId)] || [];

        if (eligibleIds.length === 0) {
          // No eligible staff data – skip validation
          continue;
        }

        const bookedStaffIds = new Set<string>();
        let anyStaffBookingsOverlapping = 0;

        // 1a. Check existing bookings
        for (const booking of allBookings) {
          if (!shouldBlockSlots(booking.status)) continue;

          if (Array.isArray(booking.services) && booking.services.length > 0) {
            for (const existSvc of booking.services) {
              if (!existSvc.time) continue;
              const existStaffId = existSvc.staffId || booking.staffId || null;
              const existStart = timeToMinutes(existSvc.time);
              const existEnd = existStart + (existSvc.duration || booking.duration || 60);

              if (!timeRangesOverlap(newStart, newEnd, existStart, existEnd)) continue;

              if (isValidStaffAssignment(existStaffId)) {
                if (eligibleIds.includes(existStaffId!)) {
                  bookedStaffIds.add(existStaffId!);
                }
              } else {
                anyStaffBookingsOverlapping++;
              }
            }
          } else {
            if (!booking.time) continue;
            const existStaffId = booking.staffId || null;
            const existStart = timeToMinutes(booking.time);
            const existEnd = existStart + (booking.duration || 60);

            if (!timeRangesOverlap(newStart, newEnd, existStart, existEnd)) continue;

            if (isValidStaffAssignment(existStaffId)) {
              if (eligibleIds.includes(existStaffId!)) {
                bookedStaffIds.add(existStaffId!);
              }
            } else {
              anyStaffBookingsOverlapping++;
            }
          }
        }

        // 1b. Check other active holds (each hold for a specific staff or "any" consumes a slot)
        for (const hold of otherActiveHolds) {
          if (!Array.isArray(hold.services)) continue;
          for (const holdSvc of hold.services) {
            if (!holdSvc.time) continue;
            const holdStaffId = holdSvc.staffId || null;
            const holdStart = timeToMinutes(holdSvc.time);
            const holdEnd = holdStart + (holdSvc.duration || 60);

            if (!timeRangesOverlap(newStart, newEnd, holdStart, holdEnd)) continue;

            if (isValidStaffAssignment(holdStaffId)) {
              if (eligibleIds.includes(holdStaffId!)) {
                bookedStaffIds.add(holdStaffId!);
              }
            } else {
              anyStaffBookingsOverlapping++;
            }
          }
        }

        const freeStaff = eligibleIds.length - bookedStaffIds.size - anyStaffBookingsOverlapping;
        if (freeStaff <= 0) {
          console.log(`[SLOT HOLD CONFLICT] All ${eligibleIds.length} eligible staff are booked at ${newSvc.time} (${bookedStaffIds.size} specific + ${anyStaffBookingsOverlapping} any-staff)`);
          return NextResponse.json(
            { error: "Time slot fully booked", details: `All available staff members are booked at ${newSvc.time}. Please choose a different time.` },
            { status: 409 }
          );
        }

        // This "Any Staff" service passed — at least one staff member is free
        continue;
      }

      // ── Specific staff mode ──
      // 1. Check against existing bookings
      for (const booking of allBookings) {
        if (!shouldBlockSlots(booking.status)) continue;

        if (Array.isArray(booking.services) && booking.services.length > 0) {
          for (const existSvc of booking.services) {
            if (!existSvc.time) continue;
            const existStaffId = existSvc.staffId || booking.staffId || null;
            const existHasStaff = isValidStaffAssignment(existStaffId);

            if (hasSpecificStaff && existHasStaff && newStaffId !== existStaffId) continue;

            const existStart = timeToMinutes(existSvc.time);
            const existEnd = existStart + (existSvc.duration || booking.duration || 60);

            if (timeRangesOverlap(newStart, newEnd, existStart, existEnd)) {
              return NextResponse.json(
                { error: "Time slot already booked", details: `${newSvc.time} conflicts with an existing booking.` },
                { status: 409 }
              );
            }
          }
        } else {
          if (!booking.time) continue;
          const existStaffId = booking.staffId || null;
          const existHasStaff = isValidStaffAssignment(existStaffId);

          if (hasSpecificStaff && existHasStaff && newStaffId !== existStaffId) continue;

          const existStart = timeToMinutes(booking.time);
          const existEnd = existStart + (booking.duration || 60);

          if (timeRangesOverlap(newStart, newEnd, existStart, existEnd)) {
            return NextResponse.json(
              { error: "Time slot already booked", details: `${newSvc.time} conflicts with an existing booking.` },
              { status: 409 }
            );
          }
        }
      }

      // 2. Check against other active holds
      for (const hold of otherActiveHolds) {
        if (!Array.isArray(hold.services)) continue;
        for (const holdSvc of hold.services) {
          if (!holdSvc.time) continue;
          const holdStaffId = holdSvc.staffId || null;
          const holdHasStaff = isValidStaffAssignment(holdStaffId);

          if (hasSpecificStaff && holdHasStaff && newStaffId !== holdStaffId) continue;

          const holdStart = timeToMinutes(holdSvc.time);
          const holdEnd = holdStart + (holdSvc.duration || 60);

          if (timeRangesOverlap(newStart, newEnd, holdStart, holdEnd)) {
            return NextResponse.json(
              { error: "Time slot is temporarily reserved", details: `${newSvc.time} is being held by another customer. Please try a different time.` },
              { status: 409 }
            );
          }
        }
      }
    }

    // --- Release any previous hold from this session for the same date ---
    // This allows a user to change their selection without accumulating holds
    const prevHolds = existingHoldsQuery.docs.filter(doc => {
      const data = doc.data();
      return data.ownerUid === String(ownerUid) && data.date === String(date) && data.expiresAt > now;
    });
    const batch = db.batch();
    for (const prevHold of prevHolds) {
      batch.update(prevHold.ref, { status: "released", releasedAt: now });
    }

    // --- Create the new hold ---
    const holdPayload = {
      ownerUid: String(ownerUid),
      branchId: String(branchId),
      date: String(date),
      sessionId: String(sessionId),
      services: services.map((s: any) => ({
        serviceId: s.serviceId || null,
        staffId: s.staffId || null,
        time: String(s.time),
        duration: Number(s.duration) || 60,
      })),
      status: "active",
      createdAt: now,
      expiresAt,
      customerUid: body.customerUid || null,
    };

    const holdRef = db.collection("slotHolds").doc();
    batch.set(holdRef, holdPayload);
    await batch.commit();

    return NextResponse.json({
      holdId: holdRef.id,
      expiresAt,
      holdDuration: HOLD_DURATION_SECONDS,
    });
  } catch (e: any) {
    console.error("Create slot hold error:", e);
    return NextResponse.json(
      { error: "Internal error", details: process.env.NODE_ENV !== "production" ? e?.message : undefined },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/slot-holds?holdId=xxx&sessionId=yyy
 *
 * Release a hold manually (e.g., when user navigates away or changes selection).
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const holdId = searchParams.get("holdId");
    const sessionId = searchParams.get("sessionId");

    if (!holdId && !sessionId) {
      return NextResponse.json({ error: "Provide holdId or sessionId" }, { status: 400 });
    }

    const db = adminDb();

    if (holdId) {
      // Release a specific hold
      const holdRef = db.collection("slotHolds").doc(holdId);
      const holdDoc = await holdRef.get();
      if (!holdDoc.exists) {
        return NextResponse.json({ error: "Hold not found" }, { status: 404 });
      }
      // Verify session ownership
      const holdData = holdDoc.data();
      if (sessionId && holdData?.sessionId !== sessionId) {
        return NextResponse.json({ error: "Session mismatch" }, { status: 403 });
      }
      await holdRef.update({ status: "released", releasedAt: Date.now() });
      return NextResponse.json({ success: true });
    } else {
      // Release ALL holds for this session
      const holdsQuery = await db.collection("slotHolds")
        .where("sessionId", "==", sessionId)
        .where("status", "==", "active")
        .get();

      const batch = db.batch();
      for (const doc of holdsQuery.docs) {
        batch.update(doc.ref, { status: "released", releasedAt: Date.now() });
      }
      await batch.commit();
      return NextResponse.json({ success: true, released: holdsQuery.size });
    }
  } catch (e: any) {
    console.error("Release slot hold error:", e);
    return NextResponse.json(
      { error: "Internal error", details: process.env.NODE_ENV !== "production" ? e?.message : undefined },
      { status: 500 }
    );
  }
}
