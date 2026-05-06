import { formatInTimeZone } from "date-fns-tz";

export type LeaveRequestLike = {
  requesterUid?: string;
  status?: string;
  fromDate?: unknown;
  toDate?: unknown;
  isFullDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
};

/** Firestore Timestamp, Date, { seconds }, or millis from JSON APIs */
export function toJsDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const withToDate = value as { toDate?: () => Date };
  if (typeof withToDate.toDate === "function") {
    try {
      const d = withToDate.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const s = (value as { seconds?: number }).seconds;
    if (typeof s === "number") return new Date(s * 1000);
  }
  return null;
}

function parseWallTimeToMinutes(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const parts = String(raw).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function timeRangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function approvedLeaveBlocksBookingSlot(
  leave: LeaveRequestLike,
  bookingYmd: string,
  bookingStartMinutes: number,
  bookingEndMinutes: number,
  branchTz: string
): boolean {
  const fromD = toJsDate(leave.fromDate);
  const toD = toJsDate(leave.toDate);
  if (!fromD || !toD) return false;

  const fromYmd = formatInTimeZone(fromD, branchTz, "yyyy-MM-dd");
  const toYmd = formatInTimeZone(toD, branchTz, "yyyy-MM-dd");
  if (bookingYmd < fromYmd || bookingYmd > toYmd) return false;

  const fullDay = leave.isFullDay !== false;
  if (fullDay) return true;

  const sm = parseWallTimeToMinutes(leave.startTime ?? undefined);
  const em = parseWallTimeToMinutes(leave.endTime ?? undefined);
  if (sm === null || em === null || em <= sm) {
    return true;
  }

  return timeRangesOverlap(bookingStartMinutes, bookingEndMinutes, sm, em);
}

export function filterApprovedLeaves(rows: LeaveRequestLike[]): LeaveRequestLike[] {
  return rows.filter((r) => String(r.status ?? "").trim().toLowerCase() === "approved");
}

export function isStaffUnavailableDueToApprovedLeave(
  approvedLeaves: LeaveRequestLike[],
  staffUid: string,
  bookingYmd: string,
  bookingStartMinutes: number,
  bookingDurationMinutes: number,
  branchTz: string
): boolean {
  const staff = String(staffUid).trim();
  const endMin = bookingStartMinutes + bookingDurationMinutes;
  for (const row of approvedLeaves) {
    if (String(row.requesterUid ?? "").trim() !== staff) continue;
    const st = String(row.status ?? "").trim().toLowerCase();
    if (st !== "approved") continue;
    if (approvedLeaveBlocksBookingSlot(row, bookingYmd, bookingStartMinutes, endMin, branchTz)) return true;
  }
  return false;
}
