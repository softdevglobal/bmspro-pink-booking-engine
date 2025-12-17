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
export type ServiceApprovalStatus = "pending" | "accepted" | "rejected" | "needs_assignment";

// Per-service completion status for tracking when staff finishes their work
export type ServiceCompletionStatus = "pending" | "completed";

// Service structure with approval and completion tracking
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
  // Per-service completion tracking (for staff to mark their work as done)
  completionStatus?: ServiceCompletionStatus;
  completedAt?: any; // Firestore timestamp or ISO string
  completedByStaffUid?: string;
  completedByStaffName?: string;
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
  // Booking workflow with partial staff assignment support:
  // 
  // Scenario A: ALL services have specific staff assigned
  //   → Status: AwaitingStaffApproval
  //   → All assigned staff members receive notifications
  //   → No admin action needed initially
  // 
  // Scenario B: SOME services have staff, SOME have "Any Available"
  //   → Status: AwaitingStaffApproval (assigned staff can respond)
  //   → Assigned staff receive notifications
  //   → Admin also gets notification to assign staff for remaining services
  //   → Services with staff have approvalStatus: "pending"
  //   → Services without staff have approvalStatus: "needs_assignment"
  // 
  // Scenario C: ALL services have "Any Available" (no staff assigned)
  //   → Status: Pending (goes to admin first)
  //   → Admin assigns staff to all services
  //   → Pending -> AwaitingStaffApproval (admin confirms, sends to staff)
  //   → Pending -> Canceled (admin cancels)
  // 
  // Staff approval flow:
  //   AwaitingStaffApproval -> PartiallyApproved (some staff accept, waiting for others)
  //   AwaitingStaffApproval -> Confirmed (all staff accept - single service or all services)
  //   AwaitingStaffApproval -> StaffRejected (any staff rejects when there's a rejected service to handle)
  //   AwaitingStaffApproval -> Canceled (admin cancels)
  // 
  // Partial approval flow:
  //   PartiallyApproved -> Confirmed (remaining staff accept)
  //   PartiallyApproved -> StaffRejected (any staff rejects - needs admin reassignment)
  //   PartiallyApproved -> Canceled (admin cancels)
  // 
  // Staff rejection flow (admin handles):
  //   StaffRejected -> AwaitingStaffApproval (admin reassigns rejected service to new staff)
  //   StaffRejected -> PartiallyApproved (admin reassigns and some are still accepted)
  //   StaffRejected -> Canceled (admin cancels after rejection)
  // 
  // Completion flow:
  //   Confirmed -> Completed (booking completed)
  //   Confirmed -> Canceled (admin cancels confirmed booking)
  
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

/**
 * Check if a booking status should block time slots (i.e., is an active booking)
 * Returns true if the booking is active and should block slots
 * Returns false if the booking is inactive (cancelled, completed, rejected) and should NOT block slots
 */
export function shouldBlockSlots(status: string | null | undefined): boolean {
  if (!status) return true; // No status = assume active (block slots)
  const normalized = normalizeBookingStatus(status);
  // These statuses should NOT block slots (booking is inactive)
  const inactiveStatuses: BookingStatus[] = ['Canceled', 'Completed', 'StaffRejected'];
  return !inactiveStatuses.includes(normalized);
}

/**
 * Check if all services in a booking are completed
 * Returns true if all services have completionStatus === "completed"
 */
export function areAllServicesCompleted(services: BookingService[]): boolean {
  if (!services || services.length === 0) return false;
  return services.every(s => s.completionStatus === "completed");
}

/**
 * Get completion progress for a booking
 * Returns { completed: number, total: number, percentage: number }
 */
export function getServiceCompletionProgress(services: BookingService[]): { completed: number; total: number; percentage: number } {
  if (!services || services.length === 0) return { completed: 0, total: 0, percentage: 0 };
  
  const total = services.length;
  const completed = services.filter(s => s.completionStatus === "completed").length;
  const percentage = Math.round((completed / total) * 100);
  
  return { completed, total, percentage };
}

