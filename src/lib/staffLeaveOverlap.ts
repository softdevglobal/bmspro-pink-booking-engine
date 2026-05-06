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

function staffCandidateIdSet(primaryId: string, aliases?: readonly string[]): Set<string> {
  const set = new Set<string>();
  const p = String(primaryId ?? "").trim();
  if (p) set.add(p);
  for (const a of aliases ?? []) {
    const t = String(a ?? "").trim();
    if (t) set.add(t);
  }
  return set;
}

function leaveRequesterMatchesStaff(requesterUid: unknown, candidates: Set<string>): boolean {
  const req = String(requesterUid ?? "").trim();
  return req !== "" && candidates.has(req);
}

/** When `users` doc id differs from stored Firebase `uid`, leave rows still use `requesterUid` from auth. */
export function staffUidAliasListForLeave(st: { id?: string; uid?: string } | null | undefined): string[] {
  if (!st) return [];
  const id = String(st.id ?? "").trim();
  const u = String((st as { uid?: string }).uid ?? "").trim();
  if (u && u !== id) return [u];
  return [];
}

export function findStaffLeavePrimaryAndAliases(
  allStaff: Array<{ id?: string; uid?: string }>,
  idFromClient: string
): { primaryId: string; aliases: string[] } {
  const key = String(idFromClient);
  const st = allStaff.find(
    (x) => String(x.id) === key || String((x as { uid?: string }).uid || "") === key
  );
  if (!st) return { primaryId: key, aliases: [] };
  return { primaryId: String(st.id), aliases: staffUidAliasListForLeave(st) };
}

/**
 * Hide stylist chip when approved leave is full-day (default) for that wall date.
 * Partial-day leave keeps the chip; per-slot overlap still blocks times.
 */
export function hideStaffChipForApprovedLeaveOnDate(
  approvedLeaves: LeaveRequestLike[],
  staffPrimaryId: string,
  staffIdAliases: readonly string[] | undefined,
  bookingYmd: string,
  branchTz: string
): boolean {
  const candidates = staffCandidateIdSet(staffPrimaryId, staffIdAliases);
  for (const row of approvedLeaves) {
    if (!leaveRequesterMatchesStaff(row.requesterUid, candidates)) continue;
    if (String(row.status ?? "").trim().toLowerCase() !== "approved") continue;
    if (row.isFullDay === false) continue;
    if (approvedLeaveBlocksBookingSlot(row, bookingYmd, 0, 24 * 60, branchTz)) return true;
  }
  return false;
}

export function isStaffUnavailableDueToApprovedLeave(
  approvedLeaves: LeaveRequestLike[],
  staffUid: string,
  bookingYmd: string,
  bookingStartMinutes: number,
  bookingDurationMinutes: number,
  branchTz: string,
  staffIdAliases?: readonly string[]
): boolean {
  const candidates = staffCandidateIdSet(staffUid, staffIdAliases);
  const endMin = bookingStartMinutes + bookingDurationMinutes;
  for (const row of approvedLeaves) {
    if (!leaveRequesterMatchesStaff(row.requesterUid, candidates)) continue;
    const st = String(row.status ?? "").trim().toLowerCase();
    if (st !== "approved") continue;
    if (approvedLeaveBlocksBookingSlot(row, bookingYmd, bookingStartMinutes, endMin, branchTz)) return true;
  }
  return false;
}
