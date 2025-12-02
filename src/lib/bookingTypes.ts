export type BookingStatus = "Pending" | "Confirmed" | "Completed" | "Canceled";

export const BOOKING_STATUSES: BookingStatus[] = ["Pending", "Confirmed", "Completed", "Canceled"];

export function normalizeBookingStatus(value: string | null | undefined): BookingStatus {
  const v = String(value || "").toLowerCase();
  if (v === "pending") return "Pending";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed") return "Completed";
  // Accept both spellings, store as single-L "Canceled" for consistency with existing data
  if (v === "canceled" || v === "cancelled") return "Canceled";
  return "Pending";
}

export function canTransitionStatus(current: BookingStatus, next: BookingStatus): boolean {
  // Allowed:
  // Pending -> Confirmed
  // Confirmed -> Completed
  // Pending -> Canceled
  if (current === "Pending" && next === "Confirmed") return true;
  if (current === "Pending" && next === "Canceled") return true;
  if (current === "Confirmed" && next === "Completed") return true;
  return false;
}

