export type BookingStatus = 
  | "Pending" 
  | "AwaitingStaffApproval" 
  | "PartiallyApproved"  // Some services accepted, waiting for others
  | "StaffRejected" 
  | "Confirmed" 
  | "Completed" 
  | "Canceled";

export const BOOKING_STATUSES: BookingStatus[] = [
  "Pending", 
  "AwaitingStaffApproval", 
  "PartiallyApproved",
  "StaffRejected", 
  "Confirmed", 
  "Completed", 
  "Canceled"
];

// Per-service approval status for multi-service bookings
export type ServiceApprovalStatus = "pending" | "accepted" | "rejected";

// Service structure with approval tracking
export interface BookingService {
  id: string | number;
  name?: string;
  price?: number;
  duration?: number;
  time?: string;
  staffId?: string | null;
  staffName?: string | null;
  // Per-service approval tracking
  approvalStatus?: ServiceApprovalStatus;
  acceptedAt?: any; // Firestore timestamp
  rejectedAt?: any; // Firestore timestamp
  rejectionReason?: string;
  respondedByStaffUid?: string;
  respondedByStaffName?: string;
}

export function normalizeBookingStatus(value: string | null | undefined): BookingStatus {
  const v = String(value || "").toLowerCase().replace(/[_\s-]/g, "");
  if (v === "pending") return "Pending";
  if (v === "awaitingstaffapproval") return "AwaitingStaffApproval";
  if (v === "partiallyapproved") return "PartiallyApproved";
  if (v === "staffrejected") return "StaffRejected";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed") return "Completed";
  // Accept both spellings, store as single-L "Canceled" for consistency with existing data
  if (v === "canceled" || v === "cancelled") return "Canceled";
  return "Pending";
}

export function canTransitionStatus(current: BookingStatus, next: BookingStatus): boolean {
  // Multi-service workflow:
  // Pending -> AwaitingStaffApproval (admin confirms, sends to staff for review)
  // Pending -> Canceled (admin cancels)
  // AwaitingStaffApproval -> PartiallyApproved (some staff accept, waiting for others)
  // AwaitingStaffApproval -> Confirmed (all staff accept - single service or all services)
  // AwaitingStaffApproval -> StaffRejected (any staff rejects when there's a rejected service to handle)
  // PartiallyApproved -> Confirmed (remaining staff accept)
  // PartiallyApproved -> StaffRejected (any staff rejects - needs admin reassignment)
  // PartiallyApproved -> Canceled (admin cancels)
  // StaffRejected -> AwaitingStaffApproval (admin reassigns rejected service to new staff)
  // StaffRejected -> PartiallyApproved (admin reassigns and some are still accepted)
  // StaffRejected -> Canceled (admin cancels after rejection)
  // Confirmed -> Completed (booking completed)
  // Confirmed -> Canceled (admin cancels confirmed booking)
  
  if (current === "Pending" && next === "AwaitingStaffApproval") return true;
  if (current === "Pending" && next === "Canceled") return true;
  if (current === "AwaitingStaffApproval" && next === "PartiallyApproved") return true;
  if (current === "AwaitingStaffApproval" && next === "Confirmed") return true;
  if (current === "AwaitingStaffApproval" && next === "StaffRejected") return true;
  if (current === "AwaitingStaffApproval" && next === "Canceled") return true;
  if (current === "PartiallyApproved" && next === "Confirmed") return true;
  if (current === "PartiallyApproved" && next === "StaffRejected") return true;
  if (current === "PartiallyApproved" && next === "Canceled") return true;
  if (current === "StaffRejected" && next === "AwaitingStaffApproval") return true;
  if (current === "StaffRejected" && next === "PartiallyApproved") return true;
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
    case "PartiallyApproved": return "Processing"; // Customer doesn't need to know details
    case "StaffRejected": return "Being Rescheduled"; // Customer-friendly message
    case "Confirmed": return "Confirmed";
    case "Completed": return "Completed";
    case "Canceled": return "Canceled";
    default: return status;
  }
}

