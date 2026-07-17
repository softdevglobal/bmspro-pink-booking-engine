import "server-only";

import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import type { BookingStatus } from "./bookingTypes";

/**
 * TextBee SMS service for the booking engine.
 *
 * Mirrors the BMS Pro Black admin-panel SMS system:
 *  - credits live on `users/{ownerUid}` (`smsMessageLimit` / `smsMessagesUsed`)
 *  - `smsMessageLimit: -1` (any negative) means unlimited
 *  - one credit is reserved in a Firestore transaction BEFORE contacting
 *    TextBee, and released again if the gateway rejects the message
 *  - every attempt (sent / failed / skipped) is appended to `sms_logs`
 *
 * Only the booking notification flow is implemented here — packages, Stripe
 * top-ups and admin UIs live in the admin panel, not the booking engine.
 */

// ─── TextBee configuration ───────────────────────────────────────────────────

const TEXTBEE_API_BASE =
  process.env.TEXTBEE_API_BASE || "https://api.textbee.dev/api/v1";
const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY || "";
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID || "";
const DEFAULT_COUNTRY_CODE =
  process.env.TEXTBEE_DEFAULT_COUNTRY_CODE || "+61";
const SUPPORTED_COUNTRY_CODES = (
  process.env.TEXTBEE_SUPPORTED_COUNTRY_CODES || "+61,+94"
)
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean);

export function isSmsConfigured(): boolean {
  return !!(TEXTBEE_API_KEY && TEXTBEE_DEVICE_ID);
}

// ─── Phone normalization (E.164) ─────────────────────────────────────────────

/**
 * Normalizes a raw phone number to E.164 (+61..., +94...).
 * Returns null when the number cannot be normalized to a supported country.
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let phone = String(raw).replace(/[\s\-().]/g, "");
  if (!phone) return null;

  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;

  if (!phone.startsWith("+")) {
    if (phone.startsWith("0")) {
      // Local format, e.g. 04xxxxxxxx → +614xxxxxxxx
      phone = `${DEFAULT_COUNTRY_CODE}${phone.slice(1)}`;
    } else {
      // Bare digits — try to match a supported country code prefix (61..., 94...)
      const matched = SUPPORTED_COUNTRY_CODES.find((code) =>
        phone.startsWith(code.slice(1))
      );
      phone = matched ? `+${phone}` : `${DEFAULT_COUNTRY_CODE}${phone}`;
    }
  }

  if (!/^\+\d{8,15}$/.test(phone)) return null;
  if (!SUPPORTED_COUNTRY_CODES.some((code) => phone.startsWith(code))) {
    return null;
  }
  return phone;
}

// ─── SMS credit enforcement (users/{ownerUid}) ───────────────────────────────

type CreditReservation =
  | { allowed: true; unlimited: boolean }
  | { allowed: false; reason: "quota_exceeded" | "credit_check_failed" };

/**
 * Reserves `count` credits inside a Firestore transaction.
 * Unlimited tenants (negative limit) are allowed without incrementing usage.
 */
async function tryConsumeSmsCredits(
  ownerUid: string,
  count = 1
): Promise<CreditReservation> {
  try {
    const db = adminDb();
    const userRef = db.doc(`users/${ownerUid}`);

    return await db.runTransaction<CreditReservation>(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() ?? {} : {};

      const limit =
        typeof data.smsMessageLimit === "number" ? data.smsMessageLimit : 0;
      const used =
        typeof data.smsMessagesUsed === "number" ? data.smsMessagesUsed : 0;

      if (limit < 0) {
        // Unlimited tenant — no usage increment.
        return { allowed: true, unlimited: true };
      }

      const remaining = Math.max(0, limit - used);
      if (remaining < count) {
        return { allowed: false, reason: "quota_exceeded" };
      }

      tx.set(
        userRef,
        { smsMessagesUsed: used + count },
        { merge: true }
      );
      return { allowed: true, unlimited: false };
    });
  } catch (error) {
    console.error(`[SMS] Credit check failed for owner ${ownerUid}:`, error);
    return { allowed: false, reason: "credit_check_failed" };
  }
}

/** Releases a previously reserved credit after a gateway failure. */
async function releaseSmsCredit(ownerUid: string, count = 1): Promise<void> {
  try {
    const db = adminDb();
    const userRef = db.doc(`users/${ownerUid}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const used =
        snap.exists && typeof snap.data()?.smsMessagesUsed === "number"
          ? (snap.data()!.smsMessagesUsed as number)
          : 0;
      tx.set(
        userRef,
        { smsMessagesUsed: Math.max(0, used - count) },
        { merge: true }
      );
    });
  } catch (error) {
    console.error(`[SMS] Failed to release credit for owner ${ownerUid}:`, error);
  }
}

// ─── sms_logs ────────────────────────────────────────────────────────────────

export type SmsStatus = "sent" | "failed" | "skipped";

type SmsLogEntry = {
  ownerUid: string | null;
  senderName: string;
  receiverPhone: string;
  receiverName: string | null;
  message: string;
  status: SmsStatus;
  statusDetail: string;
  source: string;
};

async function appendSmsLog(entry: SmsLogEntry): Promise<void> {
  try {
    const db = adminDb();
    await db.collection("sms_logs").add({
      ...entry,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Log write failures must not change the already completed SMS result.
    console.error("[SMS] Failed to append sms_logs entry:", error);
  }
}

// ─── TextBee gateway call ────────────────────────────────────────────────────

async function submitToTextBee(
  phone: string,
  message: string
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  const url = `${TEXTBEE_API_BASE}/gateway/devices/${TEXTBEE_DEVICE_ID}/send-sms`;
  const simSubscriptionId = process.env.TEXTBEE_SIM_SUBSCRIPTION_ID;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TEXTBEE_API_KEY,
      },
      body: JSON.stringify({
        recipients: [phone],
        message,
        ...(simSubscriptionId !== undefined && simSubscriptionId !== ""
          ? { simSubscriptionId: Number(simSubscriptionId) }
          : {}),
      }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const reason =
        (body && (body.message || body.error)) || `HTTP ${response.status}`;
      return { ok: false, detail: `gateway_rejected:${reason}` };
    }

    const batchId = body?.data?.smsBatchId || body?.data?._id || "";
    return {
      ok: true,
      detail: batchId ? `gateway_queued:${batchId}` : "gateway_queued",
    };
  } catch (error: any) {
    return {
      ok: false,
      detail: `gateway_error:${error?.message || "network error"}`,
    };
  }
}

// ─── Public send API ─────────────────────────────────────────────────────────

export type SendSmsInput = {
  /** Workshop owner charged for this SMS. Required for all booking sends. */
  ownerUid: string;
  to: string | null | undefined;
  message: string;
  receiverName?: string | null;
  /** Shown in the SMS log Sender column (e.g. the salon name). */
  senderName?: string | null;
  /** Raw source string; the admin panel converts it to a readable label. */
  source: string;
};

export type SendSmsResult = {
  success: boolean;
  status: SmsStatus;
  detail: string;
};

/**
 * Sends one SMS through TextBee with per-tenant credit enforcement.
 * Best-effort: never throws, so booking flows are never blocked by SMS.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const senderName = input.senderName?.trim() || "System";
  const receiverName = input.receiverName?.trim() || null;
  const message = input.message?.trim();

  const log = (
    status: SmsStatus,
    statusDetail: string,
    receiverPhone: string
  ) =>
    appendSmsLog({
      ownerUid: input.ownerUid || null,
      senderName,
      receiverPhone,
      receiverName,
      message: message || "",
      status,
      statusDetail,
      source: input.source,
    });

  if (!message) {
    console.warn(`[SMS] Skipped — empty message (source: ${input.source})`);
    await log("skipped", "empty_message", String(input.to || ""));
    return { success: false, status: "skipped", detail: "empty_message" };
  }

  const phone = normalizePhoneNumber(input.to);
  if (!phone) {
    console.warn(
      `[SMS] Skipped — invalid recipient "${input.to}" (source: ${input.source})`
    );
    await log("skipped", "invalid_recipient", String(input.to || ""));
    return { success: false, status: "skipped", detail: "invalid_recipient" };
  }

  if (!isSmsConfigured()) {
    console.warn("[SMS] Skipped — TextBee is not configured.");
    await log("skipped", "gateway_not_configured", phone);
    return {
      success: false,
      status: "skipped",
      detail: "gateway_not_configured",
    };
  }

  // Reserve one credit before contacting TextBee.
  const reservation = await tryConsumeSmsCredits(input.ownerUid, 1);
  if (!reservation.allowed) {
    console.warn(
      `[SMS] Skipped — ${reservation.reason} for owner ${input.ownerUid} (source: ${input.source})`
    );
    await log("skipped", reservation.reason, phone);
    return { success: false, status: "skipped", detail: reservation.reason };
  }

  console.log(`[SMS] Sending via TextBee`, {
    ownerUid: input.ownerUid,
    to: phone,
    source: input.source,
  });

  const gateway = await submitToTextBee(phone, message);

  if (!gateway.ok) {
    // Give the reserved credit back — the message never left the gateway.
    if (!reservation.unlimited) {
      await releaseSmsCredit(input.ownerUid, 1);
    }
    console.error(`[SMS] ❌ Send failed: ${gateway.detail}`, {
      ownerUid: input.ownerUid,
      to: phone,
      source: input.source,
    });
    await log("failed", gateway.detail, phone);
    return { success: false, status: "failed", detail: gateway.detail };
  }

  console.log(`[SMS] ✅ Queued on TextBee (${gateway.detail})`, {
    ownerUid: input.ownerUid,
    to: phone,
    source: input.source,
  });
  await log("sent", gateway.detail, phone);
  return { success: true, status: "sent", detail: gateway.detail };
}

// ─── Booking notification SMS ────────────────────────────────────────────────

export type BookingSmsData = {
  bookingCode?: string | null;
  customerPhone: string | null | undefined;
  customerName: string;
  status: BookingStatus;
  ownerUid: string;
  salonName?: string | null;
  bookingDate?: string | null;
  bookingTime?: string | null;
  serviceName?: string | null;
};

function buildBookingSmsMessage(data: BookingSmsData): string | null {
  const salon = data.salonName || "the salon";
  const code = data.bookingCode ? ` (${data.bookingCode})` : "";
  const when =
    data.bookingDate && data.bookingTime
      ? ` on ${data.bookingDate} at ${data.bookingTime}`
      : data.bookingDate
      ? ` on ${data.bookingDate}`
      : "";
  const service = data.serviceName ? ` for ${data.serviceName}` : "";

  switch (data.status) {
    case "Pending":
      return `Hi ${data.customerName}, we received your booking request${code}${service}${when} at ${salon}. We'll confirm it shortly.`;
    case "Confirmed":
      return `Hi ${data.customerName}, your booking${code}${service}${when} at ${salon} is confirmed. See you soon!`;
    case "Completed":
      return `Hi ${data.customerName}, thank you for visiting ${salon}! We hope to see you again soon.`;
    case "Canceled":
      return `Hi ${data.customerName}, your booking${code}${when} at ${salon} has been cancelled. Contact us to reschedule.`;
    default:
      return null;
  }
}

async function getSalonName(ownerUid: string): Promise<string | null> {
  try {
    const snap = await adminDb().doc(`users/${ownerUid}`).get();
    if (snap.exists) {
      const data = snap.data();
      return (
        data?.salonName ||
        data?.name ||
        data?.businessName ||
        data?.displayName ||
        null
      );
    }
  } catch (error) {
    console.error("[SMS] Error fetching salon name:", error);
  }
  return null;
}

/**
 * Sends the customer a booking notification SMS and charges one credit to the
 * workshop owner. Uses the same source string patterns as the admin panel so
 * its SMS log shows labels like "Booking · Pending".
 */
export async function sendBookingSms(data: BookingSmsData): Promise<SendSmsResult> {
  if (!data.salonName) {
    data.salonName = await getSalonName(data.ownerUid);
  }
  const message = buildBookingSmsMessage(data);
  if (!message) {
    return {
      success: false,
      status: "skipped",
      detail: `no_sms_for_status:${data.status}`,
    };
  }

  return sendSms({
    ownerUid: data.ownerUid,
    to: data.customerPhone,
    message,
    receiverName: data.customerName,
    senderName: data.salonName || null,
    source: `booking ${data.status} notification for ${data.bookingCode || "booking"}`,
  });
}
