import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  DocumentData,
} from "firebase/firestore";
import { apiUrl } from "@/lib/apiUrl";

/**
 * Hold duration in seconds (must match server constant).
 */
export const HOLD_DURATION_SECONDS = 300;

/**
 * Generate a unique session ID for this browser tab.
 * Persisted in sessionStorage so it survives soft-navigation
 * but each tab gets its own ID.
 */
export function getOrCreateSessionId(): string {
  const KEY = "bmspro_booking_session_id";
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export interface SlotHoldService {
  serviceId: string | number;
  staffId?: string | null;
  time: string;       // HH:mm
  duration: number;   // minutes
}

export interface SlotHoldResult {
  holdId: string;
  expiresAt: number;  // epoch ms
  holdDuration: number; // seconds
}

/**
 * Create (or replace) a temporary hold for the customer's selected slots.
 *
 * The API automatically releases any previous hold for the same session + date
 * before creating the new one.
 */
export async function createSlotHold(
  ownerUid: string,
  branchId: string,
  date: string,
  services: SlotHoldService[],
  customerUid?: string | null,
): Promise<SlotHoldResult> {
  const sessionId = getOrCreateSessionId();

  const res = await fetch(apiUrl("/api/slot-holds"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerUid,
      branchId,
      date,
      sessionId,
      services,
      customerUid: customerUid || null,
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    const err: any = new Error(json?.error || "Failed to hold slot");
    err.status = res.status;
    err.details = json?.details;
    throw err;
  }

  return json as SlotHoldResult;
}

/**
 * Release all holds for the current session.
 * Call this when the user navigates away, resets the form, or the booking completes.
 */
export async function releaseAllHolds(): Promise<void> {
  const sessionId = getOrCreateSessionId();
  try {
    await fetch(apiUrl(`/api/slot-holds?sessionId=${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
    });
  } catch (e) {
    console.warn("Failed to release holds:", e);
  }
}

/**
 * Release a specific hold.
 */
export async function releaseHold(holdId: string): Promise<void> {
  const sessionId = getOrCreateSessionId();
  try {
    await fetch(
      apiUrl(`/api/slot-holds?holdId=${encodeURIComponent(holdId)}&sessionId=${encodeURIComponent(sessionId)}`),
      { method: "DELETE" }
    );
  } catch (e) {
    console.warn("Failed to release hold:", e);
  }
}

/**
 * Subscribe to real-time slot holds for a given owner + date.
 *
 * Returns all *active* holds (including expired ones that haven't been cleaned up yet;
 * the caller should filter by `expiresAt > Date.now()`).
 *
 * The subscription fires on every change so the UI can immediately reflect
 * when a hold is created or released by another customer.
 */
export function subscribeSlotHolds(
  ownerUid: string,
  date: string,
  onChange: (holds: Array<{ id: string } & DocumentData>) => void,
) {
  const q = query(
    collection(db, "slotHolds"),
    where("ownerUid", "==", ownerUid),
    where("date", "==", date),
    where("status", "==", "active"),
  );

  return onSnapshot(
    q,
    (snap) => {
      const holds = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      onChange(holds);
    },
    (error) => {
      if (error.code === "permission-denied") {
        // Customers might not have direct read access - that's OK
        // Holds are still enforced server-side
        console.warn("Permission denied for slotHolds query (server-side enforcement still active).");
        onChange([]);
      } else {
        console.error("Error in slotHolds snapshot:", error);
        onChange([]);
      }
    },
  );
}

/**
 * Check if a staffId represents "Any Available Staff" (not a specific staff assignment).
 * Matches the server-side isValidStaffAssignment logic (inverted).
 */
function isAnyStaffValue(sid: string | null | undefined): boolean {
  if (!sid) return true;
  const s = sid.toString().toLowerCase().trim();
  if (s === "" || s === "null") return true;
  if (s.includes("any")) return true;
  return false;
}

/**
 * Check if a specific time + staff combination is held by another session.
 *
 * @param holds - Active holds from subscribeSlotHolds (pre-filtered for expiry by caller)
 * @param staffId - The staff ID to check (null/"any" = "Any Staff")
 * @param time - HH:mm
 * @param duration - Service duration in minutes
 * @param mySessionId - Current session ID to exclude own holds
 * @param eligibleStaffIds - (optional) For "Any Staff" mode, the list of eligible staff IDs.
 *   When provided and staffId is null/any, the slot is only considered held if ALL eligible
 *   staff are occupied by holds from other sessions.
 * @returns true if the slot is held by someone else
 */
export function isSlotHeldByOther(
  holds: Array<{ id: string } & DocumentData>,
  staffId: string | null,
  time: string,
  duration: number,
  mySessionId: string,
  eligibleStaffIds?: string[],
): boolean {
  const now = Date.now();
  const newStart = timeToMinutes(time);
  const newEnd = newStart + duration;

  // "Any Staff" mode: only held if ALL eligible staff are consumed by other holds + bookings.
  // Triggered when staffId is null/"any"/empty AND eligibleStaffIds are provided.
  const isAnyStaff = isAnyStaffValue(staffId);

  if (isAnyStaff && eligibleStaffIds && eligibleStaffIds.length > 0) {
    const heldStaffIds = new Set<string>();
    let anyStaffHoldsOverlapping = 0;

    for (const hold of holds) {
      if (hold.sessionId === mySessionId) continue;
      if (hold.expiresAt <= now) continue;
      if (!Array.isArray(hold.services)) continue;

      for (const svc of hold.services) {
        if (!svc.time) continue;
        const holdStart = timeToMinutes(svc.time);
        const holdEnd = holdStart + (svc.duration || 60);

        if (newStart < holdEnd && holdStart < newEnd) {
          // Use isAnyStaffValue to properly detect "any" staffId in holds
          if (!isAnyStaffValue(svc.staffId) && eligibleStaffIds.includes(svc.staffId)) {
            heldStaffIds.add(svc.staffId);
          } else if (isAnyStaffValue(svc.staffId)) {
            // Hold is also "Any Staff" — it consumes one staff slot from the pool
            anyStaffHoldsOverlapping++;
          }
        }
      }
    }

    const freeStaff = eligibleStaffIds.length - heldStaffIds.size - anyStaffHoldsOverlapping;
    return freeStaff <= 0;
  }

  // Specific staff mode (original logic)
  for (const hold of holds) {
    // Skip own holds
    if (hold.sessionId === mySessionId) continue;
    // Skip expired holds
    if (hold.expiresAt <= now) continue;
    // Check each service in the hold
    if (!Array.isArray(hold.services)) continue;
    for (const svc of hold.services) {
      if (!svc.time) continue;
      const holdStart = timeToMinutes(svc.time);
      const holdEnd = holdStart + (svc.duration || 60);

      // Check time overlap
      if (newStart < holdEnd && holdStart < newEnd) {
        // If both have specific staff, only conflict if same staff
        if (staffId && !isAnyStaffValue(staffId) && svc.staffId && !isAnyStaffValue(svc.staffId) && staffId !== svc.staffId) continue;
        return true;
      }
    }
  }
  return false;
}

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":").map(Number);
  if (parts.length < 2) return 0;
  return parts[0] * 60 + parts[1];
}
