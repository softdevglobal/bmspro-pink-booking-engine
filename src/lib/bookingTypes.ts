export type BookingStatus = 
  | "Pending" 
  | "AwaitingStaffApproval" 
  | "StaffRejected" 
  | "Confirmed" 
  | "Completed" 
  | "Canceled";

export const BOOKING_STATUSES: BookingStatus[] = [
  "Pending", 
  "AwaitingStaffApproval", 
  "StaffRejected", 
  "Confirmed", 
  "Completed", 
  "Canceled"
];

export function normalizeBookingStatus(value: string | null | undefined): BookingStatus {
  const v = String(value || "").toLowerCase().replace(/[_\s-]/g, "");
  if (v === "pending") return "Pending";
  if (v === "awaitingstaffapproval") return "AwaitingStaffApproval";
  if (v === "staffrejected") return "StaffRejected";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed") return "Completed";
  // Accept both spellings, store as single-L "Canceled" for consistency with existing data
  if (v === "canceled" || v === "cancelled") return "Canceled";
  return "Pending";
}

export function canTransitionStatus(current: BookingStatus, next: BookingStatus): boolean {
  // New workflow:
  // Pending -> AwaitingStaffApproval (admin confirms, sends to staff for review)
  // Pending -> Canceled (admin cancels)
  // AwaitingStaffApproval -> Confirmed (staff accepts)
  // AwaitingStaffApproval -> StaffRejected (staff rejects)
  // StaffRejected -> AwaitingStaffApproval (admin reassigns to new staff)
  // StaffRejected -> Canceled (admin cancels after rejection)
  // Confirmed -> Completed (booking completed)
  // Confirmed -> Canceled (admin cancels confirmed booking)
  
  if (current === "Pending" && next === "AwaitingStaffApproval") return true;
  if (current === "Pending" && next === "Canceled") return true;
  if (current === "AwaitingStaffApproval" && next === "Confirmed") return true;
  if (current === "AwaitingStaffApproval" && next === "StaffRejected") return true;
  if (current === "StaffRejected" && next === "AwaitingStaffApproval") return true;
  if (current === "StaffRejected" && next === "Canceled") return true;
  if (current === "Confirmed" && next === "Completed") return true;
  if (current === "Confirmed" && next === "Canceled") return true;
  return false;
}

/**
 * Get human-readable status label for customers
 */
export function getCustomerStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "Pending": return "Pending Review";
    case "AwaitingStaffApproval": return "Processing"; // Don't confuse customer with internal workflow
    case "StaffRejected": return "Being Rescheduled"; // Customer-friendly message
    case "Confirmed": return "Confirmed";
    case "Completed": return "Completed";
    case "Canceled": return "Canceled";
    default: return status;
  }
}

