import sgMail from "@sendgrid/mail";
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import type { BookingStatus } from "./bookingTypes";

// Initialize SendGrid
let SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@bmspros.com.au";

/**
 * Ensure SendGrid is initialized with API key
 * This function checks and initializes SendGrid at runtime
 */
function ensureSendGridInitialized(): boolean {
  // Re-check environment variable in case it was set after module load
  if (!SENDGRID_API_KEY || SENDGRID_API_KEY.trim() === "") {
    SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  }
  
  if (SENDGRID_API_KEY && SENDGRID_API_KEY.trim()) {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY.trim());
      return true;
    } catch (error) {
      console.error("[EMAIL] Failed to set SendGrid API key:", error);
      return false;
    }
  }
  
  return false;
}

// Initialize SendGrid API key if available at module load
if (SENDGRID_API_KEY && SENDGRID_API_KEY.trim()) {
  sgMail.setApiKey(SENDGRID_API_KEY.trim());
  console.log("[EMAIL] ✅ SendGrid initialized successfully");
} else {
  console.warn("[EMAIL] ⚠️  SendGrid API key not found in environment variables");
  console.warn("[EMAIL] Please set SENDGRID_API_KEY in your .env.local file");
  console.warn("[EMAIL] Example: SENDGRID_API_KEY=SG.your-api-key-here");
}

/**
 * Get salon name from ownerUid
 */
async function getSalonName(ownerUid: string): Promise<string> {
  try {
    const db = adminDb();
    const ownerDoc = await db.doc(`users/${ownerUid}`).get();
    if (ownerDoc.exists) {
      const data = ownerDoc.data();
      return data?.salonName || data?.name || data?.businessName || data?.displayName || "Salon";
    }
  } catch (error) {
    console.error("Error fetching salon name:", error);
  }
  return "Salon";
}

interface BookingEmailData {
  bookingId: string;
  bookingCode?: string | null;
  customerEmail: string;
  customerName: string;
  status: BookingStatus;
  branchName?: string | null;
  bookingDate?: string | null;
  bookingTime?: string | null;
  duration?: number | null;
  price?: number | null;
  serviceName?: string | null;
  services?: Array<{
    name?: string;
    staffName?: string | null;
    time?: string;
    duration?: number;
  }>;
  staffName?: string | null;
  ownerUid: string;
  salonName?: string;
}

/**
 * Check if an email has already been sent for this booking and status
 */
async function hasEmailBeenSent(bookingId: string, status: BookingStatus): Promise<boolean> {
  try {
    const db = adminDb();
    const emailLogQuery = await db.collection("bookingEmails")
      .where("bookingId", "==", bookingId)
      .where("status", "==", status)
      .limit(1)
      .get();
    
    return !emailLogQuery.empty;
  } catch (error) {
    console.error("Error checking email log:", error);
    // If we can't check, allow sending to avoid blocking emails
    return false;
  }
}

/**
 * Log that an email was sent to prevent duplicates
 */
async function logEmailSent(bookingId: string, status: BookingStatus, customerEmail: string): Promise<void> {
  try {
    const db = adminDb();
    await db.collection("bookingEmails").add({
      bookingId,
      status,
      customerEmail,
      sentAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Error logging email:", error);
    // Don't throw - logging failure shouldn't block email sending
  }
}

/**
 * Format booking date and time for display
 */
function formatBookingDateTime(date?: string | null, time?: string | null): string {
  if (!date) return "Not specified";
  
  try {
    const dateObj = new Date(date);
    const dateStr = dateObj.toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    
    if (time) {
      return `${dateStr} at ${time}`;
    }
    return dateStr;
  } catch (error) {
    return date || "Not specified";
  }
}

/**
 * Format price for display
 */
function formatPrice(price?: number | null): string {
  if (price === null || price === undefined) return "Not specified";
  return `$${price.toFixed(2)}`;
}

/**
 * Format duration for display
 */
function formatDuration(duration?: number | null): string {
  if (duration === null || duration === undefined) return "Not specified";
  if (duration < 60) return `${duration} minutes`;
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  if (minutes === 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minute${minutes > 1 ? "s" : ""}`;
}

/**
 * Generate HTML email template
 */
function generateEmailHTML(
  status: BookingStatus,
  data: BookingEmailData
): string {
  const bookingDateTime = formatBookingDateTime(data.bookingDate, data.bookingTime);
  const bookingCode = data.bookingCode || "N/A";
  const salonName = data.salonName || "Salon";
  
  // Helper function to check if staff is "Any Available"
  const isAnyStaff = (staffName?: string | null): boolean => {
    if (!staffName) return true;
    const name = staffName.toLowerCase();
    return name.includes("any available") || name.includes("any staff") || name === "any" || name.trim() === "";
  };

  // Check if any service has unassigned staff
  let hasUnassignedStaff = false;
  if (data.services && data.services.length > 0) {
    hasUnassignedStaff = data.services.some(s => isAnyStaff(s.staffName));
  } else {
    hasUnassignedStaff = isAnyStaff(data.staffName);
  }

  // Build services list
  let servicesList = "";
  if (data.services && data.services.length > 0) {
    const services = data.services; // Store reference to avoid repeated checks
    servicesList = "<table style='width: 100%; border-collapse: collapse; margin: 15px 0;'>";
    services.forEach((service, index) => {
      const serviceTime = service.time ? ` at ${service.time}` : "";
      const serviceDuration = service.duration ? ` (${formatDuration(service.duration)})` : "";
      const serviceHasStaff = service.staffName && !isAnyStaff(service.staffName);
      const staffInfo = serviceHasStaff ? ` with ${service.staffName}` : "";
      const borderBottom = index < services.length - 1 ? "border-bottom: 1px solid #e5e7eb;" : "";
      servicesList += `
        <tr style='${borderBottom}'>
          <td style='padding: 12px 0; color: #374151; font-size: 15px;'>
            <strong style='color: #111827;'>${service.name || "Service"}</strong>${serviceTime}${serviceDuration}${staffInfo}
          </td>
        </tr>
      `;
    });
    servicesList += "</table>";
  } else if (data.serviceName) {
    servicesList = `<p style='margin: 12px 0; color: #374151; font-size: 15px;'><strong style='color: #111827;'>${data.serviceName}</strong></p>`;
  }
  
  // Staff info - only show if staff is assigned, otherwise show appropriate message
  const staffInfo = data.staffName && !isAnyStaff(data.staffName) ? `
    <tr>
      <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Staff Member</td>
      <td style='padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;'>${data.staffName}</td>
    </tr>
  ` : "";
  
  // Staff assignment message for unassigned staff
  const staffAssignmentMessage = hasUnassignedStaff ? `
    <tr>
      <td colspan="2" style='padding: 12px 0;'>
        <div style='background-color: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-top: 8px;'>
          <p style='margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;'>
            <strong style='color: #78350f;'>ℹ️ Staff Assignment:</strong><br>
            ${status === "Pending" 
              ? "After confirming your booking, we will assign the best available staff member for your service." 
              : status === "Confirmed"
              ? "A staff member will be assigned to your booking and you will be notified once confirmed."
              : "Staff will be assigned to your booking."}
          </p>
        </div>
      </td>
    </tr>
  ` : "";
  
  const branchInfo = data.branchName ? `
    <tr>
      <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Branch</td>
      <td style='padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;'>${data.branchName}</td>
    </tr>
  ` : "";
  
  const priceInfo = data.price !== null && data.price !== undefined ? `
    <tr>
      <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Total Price</td>
      <td style='padding: 8px 0; color: #111827; font-size: 16px; font-weight: 600; text-align: right;'>${formatPrice(data.price)}</td>
    </tr>
  ` : "";
  
  const durationInfo = data.duration ? `
    <tr>
      <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Duration</td>
      <td style='padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;'>${formatDuration(data.duration)}</td>
    </tr>
  ` : "";
  
  let subject = "";
  let title = "";
  let message = "";
  let icon = "";
  let color = "#6366f1";
  let bgColor = "#f0f9ff";
  
  switch (status) {
    case "Pending":
      subject = `Booking Request Received - ${salonName}`;
      title = "Booking Request Received";
      message = `Thank you for your booking request! We have received your request and will confirm it shortly.`;
      icon = "📋";
      color = "#f59e0b";
      bgColor = "#fffbeb";
      break;
    case "Confirmed":
      subject = `Booking Confirmed - ${salonName}`;
      title = "Booking Confirmed";
      message = `Great news! Your booking has been confirmed. We look forward to seeing you soon!`;
      icon = "✅";
      color = "#10b981";
      bgColor = "#ecfdf5";
      break;
    case "Completed":
      subject = `Thank You - ${salonName}`;
      title = "Booking Completed";
      message = `Thank you for visiting ${salonName}! We hope you had a wonderful experience and look forward to seeing you again.`;
      icon = "✨";
      color = "#6366f1";
      bgColor = "#eef2ff";
      break;
    case "Canceled":
      subject = `Booking Cancelled - ${salonName}`;
      title = "Booking Cancelled";
      message = `Your booking has been cancelled. If you have any questions or would like to reschedule, please contact us.`;
      icon = "❌";
      color = "#ef4444";
      bgColor = "#fef2f2";
      break;
    default:
      subject = `Booking Update - ${salonName}`;
      title = "Booking Update";
      message = `Your booking status has been updated.`;
      icon = "ℹ️";
  }
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Salon Header -->
          <tr>
            <td style="padding: 0; background: linear-gradient(135deg, ${color} 0%, ${color}dd 100%);">
              <!-- Salon Name Bar -->
              <div style="padding: 20px 40px; background-color: rgba(0,0,0,0.1); text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">${salonName}</h1>
              </div>
              <!-- Status Section -->
              <div style="padding: 35px 40px; text-align: center;">
                <div style="font-size: 56px; margin-bottom: 15px; line-height: 1;">${icon}</div>
                <h2 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: -0.3px;">${title}</h2>
              </div>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0 0 15px; color: #374151; font-size: 16px; line-height: 1.6;">Hello ${data.customerName},</p>
              <p style="margin: 0 0 25px; color: #374151; font-size: 16px; line-height: 1.6;">${message}</p>
            </td>
          </tr>
          
          <!-- Booking Details Card -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: ${bgColor}; border: 2px solid ${color}20; border-radius: 10px; padding: 25px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 20px; color: #111827; font-size: 18px; font-weight: 600; display: flex; align-items: center;">
                  <span style="display: inline-block; width: 4px; height: 20px; background-color: ${color}; border-radius: 2px; margin-right: 10px;"></span>
                  Booking Details
                </h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Booking Code</td>
                    <td style='padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right; font-family: monospace;'>${bookingCode}</td>
                  </tr>
                  <tr>
                    <td style='padding: 8px 0; color: #6b7280; font-size: 14px;'>Date & Time</td>
                    <td style='padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;'>${bookingDateTime}</td>
                  </tr>
                  ${branchInfo}
                  ${durationInfo}
                  ${staffInfo}
                  ${priceInfo}
                </table>
                ${staffAssignmentMessage}
                
                ${servicesList ? `
                  <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid ${color}30;">
                    <p style="margin: 0 0 10px; color: #6b7280; font-size: 14px; font-weight: 500;">Services</p>
                    ${servicesList}
                  </div>
                ` : ""}
              </div>
            </td>
          </tr>
          
          <!-- Additional Message -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; text-align: center;">
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                  If you have any questions or need to make changes to your booking, please don't hesitate to contact us.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 25px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 600;">${salonName}</p>
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.5;">
                This is an automated email. Please do not reply to this message.<br>
                If you need assistance, please contact us directly.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send booking email to customer
 * Only sends if email hasn't been sent for this booking and status
 */
export async function sendBookingEmail(data: BookingEmailData): Promise<{ success: boolean; error?: string }> {
  console.log(`[EMAIL] Attempting to send email for booking ${data.bookingId}, status: ${data.status}, to: ${data.customerEmail}`);
  
  // Validate email
  if (!data.customerEmail || !data.customerEmail.trim()) {
    console.error(`[EMAIL] No customer email provided for booking ${data.bookingId}`);
    return { success: false, error: "No customer email provided" };
  }
  
  const email = data.customerEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error(`[EMAIL] Invalid email address: ${email} for booking ${data.bookingId}`);
    return { success: false, error: "Invalid email address" };
  }
  
  // Check if email should be sent for this status
  const emailStatuses: BookingStatus[] = ["Pending", "Confirmed", "Completed", "Canceled"];
  if (!emailStatuses.includes(data.status)) {
    console.log(`[EMAIL] Email not configured for status: ${data.status} (booking ${data.bookingId})`);
    return { success: false, error: `Email not configured for status: ${data.status}` };
  }
  
  // Check if email has already been sent
  const alreadySent = await hasEmailBeenSent(data.bookingId, data.status);
  if (alreadySent) {
    console.log(`[EMAIL] Email already sent for booking ${data.bookingId} with status ${data.status}`);
    return { success: false, error: "Email already sent for this status" };
  }
  
  // Ensure SendGrid is initialized
  if (!ensureSendGridInitialized()) {
    console.error(`[EMAIL] SendGrid API key not configured!`);
    console.error(`[EMAIL] Please set SENDGRID_API_KEY in your .env.local file`);
    return { success: false, error: "SendGrid API key not configured. Please contact support." };
  }
  
  try {
    // Fetch salon name if not provided
    if (!data.salonName) {
      data.salonName = await getSalonName(data.ownerUid);
    }
    
    const html = generateEmailHTML(data.status, data);
    const salonName = data.salonName || "Salon";
    const subject = data.bookingCode 
      ? `${data.status === "Pending" ? "Booking Request Received" : data.status === "Confirmed" ? "Booking Confirmed" : data.status === "Completed" ? "Thank You" : "Booking " + data.status} - ${salonName} (${data.bookingCode})`
      : `${data.status === "Pending" ? "Booking Request Received" : data.status === "Confirmed" ? "Booking Confirmed" : data.status === "Completed" ? "Thank You" : "Booking " + data.status} - ${salonName}`;
    
    const msg = {
      to: email,
      from: FROM_EMAIL,
      subject: subject,
      html: html,
    };
    
    console.log(`[EMAIL] Sending email via SendGrid:`, {
      to: email,
      from: FROM_EMAIL,
      subject: subject,
      bookingId: data.bookingId,
      status: data.status,
      salonName: salonName,
    });
    
    await sgMail.send(msg);
    
    // Log that email was sent
    await logEmailSent(data.bookingId, data.status, email);
    
    console.log(`[EMAIL] ✅ Booking email sent successfully: ${data.bookingId} - ${data.status} to ${email}`);
    return { success: true };
  } catch (error: any) {
    console.error(`[EMAIL] ❌ Error sending booking email for ${data.bookingId}:`, error);
    console.error(`[EMAIL] Error details:`, {
      message: error?.message,
      code: error?.code,
      response: error?.response?.body,
      statusCode: error?.response?.statusCode,
    });
    const errorMessage = error?.response?.body?.errors?.[0]?.message || error?.message || "Unknown error";
    return { success: false, error: errorMessage };
  }
}

/**
 * Send email when booking is created (Request Received)
 */
export async function sendBookingRequestReceivedEmail(
  bookingId: string,
  bookingCode: string | null | undefined,
  customerEmail: string | null | undefined,
  customerName: string,
  ownerUid: string,
  bookingData: {
    branchName?: string | null;
    bookingDate?: string | null;
    bookingTime?: string | null;
    duration?: number | null;
    price?: number | null;
    serviceName?: string | null;
    services?: Array<{
      name?: string;
      staffName?: string | null;
      time?: string;
      duration?: number;
    }>;
    staffName?: string | null;
  }
): Promise<void> {
  console.log(`[EMAIL] sendBookingRequestReceivedEmail called for booking ${bookingId}`, {
    customerEmail,
    customerName,
    bookingCode,
  });
  
  if (!customerEmail) {
    console.log(`[EMAIL] No email provided for booking ${bookingId}, skipping email`);
    return;
  }
  
  // Get salon name
  const salonName = await getSalonName(ownerUid);
  
  const result = await sendBookingEmail({
    bookingId,
    bookingCode: bookingCode || undefined,
    customerEmail,
    customerName,
    status: "Pending",
    ownerUid,
    salonName,
    ...bookingData,
  });
  
  if (!result.success) {
    console.error(`[EMAIL] Failed to send booking request received email:`, result.error);
  }
}

/**
 * Send email when booking status changes to Confirmed, Completed, or Canceled
 */
export async function sendBookingStatusChangeEmail(
  bookingId: string,
  newStatus: BookingStatus,
  customerEmail: string | null | undefined,
  customerName: string,
  ownerUid: string,
  bookingData: {
    bookingCode?: string | null;
    branchName?: string | null;
    bookingDate?: string | null;
    bookingTime?: string | null;
    duration?: number | null;
    price?: number | null;
    serviceName?: string | null;
    services?: Array<{
      name?: string;
      staffName?: string | null;
      time?: string;
      duration?: number;
    }>;
    staffName?: string | null;
  }
): Promise<void> {
  console.log(`[EMAIL] sendBookingStatusChangeEmail called for booking ${bookingId}`, {
    newStatus,
    customerEmail,
    customerName,
  });
  
  // Only send emails for specific statuses
  const emailStatuses: BookingStatus[] = ["Confirmed", "Completed", "Canceled"];
  if (!emailStatuses.includes(newStatus)) {
    console.log(`[EMAIL] Status ${newStatus} does not require email, skipping`);
    return;
  }
  
  if (!customerEmail) {
    console.log(`[EMAIL] No email provided for booking ${bookingId}, skipping email`);
    return;
  }
  
  // Get salon name
  const salonName = await getSalonName(ownerUid);
  
  const result = await sendBookingEmail({
    bookingId,
    bookingCode: bookingData.bookingCode || undefined,
    customerEmail,
    customerName,
    status: newStatus,
    ownerUid,
    salonName,
    ...bookingData,
  });
  
  if (!result.success) {
    console.error(`[EMAIL] Failed to send booking status change email:`, result.error);
  }
}

/**
 * Generate HTML for password reset email with 6-digit code
 */
function generatePasswordResetEmailHTML(
  userName: string,
  resetCode: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - BMS PRO PINK</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 0; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);">
              <div style="padding: 40px; text-align: center;">
                <div style="font-size: 56px; margin-bottom: 15px; line-height: 1;">🔐</div>
                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.3px;">Reset Your Password</h1>
                <p style="margin: 15px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">BMS PRO PINK</p>
              </div>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0 0 15px; color: #374151; font-size: 16px; line-height: 1.6;">Hello ${userName},</p>
              <p style="margin: 0 0 25px; color: #374151; font-size: 16px; line-height: 1.6;">
                We received a request to reset your password for your BMS PRO PINK account. Use the 6-digit code below to verify your identity and reset your password.
              </p>
            </td>
          </tr>
          
          <!-- Verification Code -->
          <tr>
            <td style="padding: 0 40px 30px; text-align: center;">
              <div style="background: linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%); border: 2px solid #f59e0b; border-radius: 16px; padding: 30px; margin-bottom: 20px;">
                <p style="margin: 0 0 15px; color: #78350f; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
                <div style="font-size: 48px; font-weight: 700; letter-spacing: 8px; color: #92400e; font-family: monospace; margin: 15px 0;">
                  ${resetCode}
                </div>
                <p style="margin: 15px 0 0; color: #92400e; font-size: 13px;">Enter this code on the password reset page</p>
              </div>
            </td>
          </tr>
          
          <!-- Warning -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #fff7ed; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px;">
                <p style='margin: 0; color: #92400e; font-size: 13px; line-height: 1.6;'>
                  <strong style='color: #78350f;'>⚠️ Important:</strong> This code will expire in 15 minutes. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Instructions -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background-color: #eef2ff; border-radius: 8px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #312e81; font-size: 14px; font-weight: 600;">How to reset your password:</p>
                <ol style="margin: 0; padding-left: 20px; color: #374151; font-size: 14px; line-height: 1.8;">
                  <li style="margin-bottom: 8px;">Go to the password reset page</li>
                  <li style="margin-bottom: 8px;">Enter your email address and the 6-digit code</li>
                  <li style="margin-bottom: 8px;">Create a new secure password</li>
                  <li>Sign in with your new password</li>
                </ol>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 25px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 600;">BMS PRO PINK</p>
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.5;">
                This is an automated email from BMS PRO PINK.<br>
                Please do not reply to this message.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send password reset email to user with 6-digit code
 */
export async function sendPasswordResetEmail(
  email: string,
  userName: string,
  resetCode: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[EMAIL] Attempting to send password reset email to: ${email}`);
  
  // Validate email
  if (!email || !email.trim()) {
    console.error(`[EMAIL] No email provided`);
    return { success: false, error: "No email provided" };
  }
  
  const emailAddress = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailAddress)) {
    console.error(`[EMAIL] Invalid email address: ${emailAddress}`);
    return { success: false, error: "Invalid email address" };
  }
  
  // Ensure SendGrid is initialized
  if (!ensureSendGridInitialized()) {
    console.error(`[EMAIL] SendGrid API key not configured!`);
    console.error(`[EMAIL] Please set SENDGRID_API_KEY in your .env.local file`);
    return { success: false, error: "SendGrid API key not configured. Please contact support." };
  }
  
  try {
    const html = generatePasswordResetEmailHTML(userName, resetCode);
    const subject = `Reset Your Password - BMS PRO PINK`;
    
    const msg = {
      to: emailAddress,
      from: FROM_EMAIL,
      subject: subject,
      html: html,
      trackingSettings: {
        clickTracking: {
          enable: false, // Disable click tracking so links go directly to destination
        },
      },
    };
    
    console.log(`[EMAIL] Sending password reset email via SendGrid:`, {
      to: emailAddress,
      from: FROM_EMAIL,
      subject: subject,
    });
    
    await sgMail.send(msg);
    
    console.log(`[EMAIL] ✅ Password reset email sent successfully to ${emailAddress}`);
    return { success: true };
  } catch (error: any) {
    console.error(`[EMAIL] ❌ Error sending password reset email to ${emailAddress}:`, error);
    console.error(`[EMAIL] Error details:`, {
      message: error?.message,
      code: error?.code,
      response: error?.response?.body,
      statusCode: error?.response?.statusCode,
    });
    const errorMessage = error?.response?.body?.errors?.[0]?.message || error?.message || "Unknown error";
    return { success: false, error: errorMessage };
  }
}

/**
 * Generate HTML for welcome email when customer registers
 */
function generateWelcomeEmailHTML(
  userName: string,
  salonName: string
): string {
  const bookingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://pink.bmspros.com.au"}/book`;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${salonName} - BMS PRO PINK</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f3f4f6;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 0; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);">
              <div style="padding: 40px; text-align: center;">
                <div style="font-size: 56px; margin-bottom: 15px; line-height: 1;">🎉</div>
                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.3px;">Welcome to ${salonName}!</h1>
                <p style="margin: 15px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">BMS PRO PINK</p>
              </div>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0 0 15px; color: #374151; font-size: 16px; line-height: 1.6;">Hello ${userName},</p>
              <p style="margin: 0 0 25px; color: #374151; font-size: 16px; line-height: 1.6;">
                Thank you for creating an account with ${salonName}! We're thrilled to have you as part of our community.
              </p>
            </td>
          </tr>
          
          <!-- Welcome Message -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <div style="background: linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%); border: 2px solid #f59e0b; border-radius: 16px; padding: 30px; margin-bottom: 20px;">
                <p style="margin: 0 0 15px; color: #78350f; font-size: 16px; font-weight: 600; text-align: center;">
                  You're all set! 🎊
                </p>
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6; text-align: center;">
                  Your account has been successfully created. You can now book appointments, manage your bookings, and enjoy all the services ${salonName} has to offer.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 25px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 600;">${salonName}</p>
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.5;">
                This is an automated email from BMS PRO PINK.<br>
                Please do not reply to this message.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Send welcome email to customer when they register for a salon
 */
export async function sendWelcomeEmail(
  email: string,
  userName: string,
  ownerUid: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[EMAIL] Attempting to send welcome email to: ${email}`);
  
  // Validate email
  if (!email || !email.trim()) {
    console.error(`[EMAIL] No email provided`);
    return { success: false, error: "No email provided" };
  }
  
  const emailAddress = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailAddress)) {
    console.error(`[EMAIL] Invalid email address: ${emailAddress}`);
    return { success: false, error: "Invalid email address" };
  }
  
  // Ensure SendGrid is initialized
  if (!ensureSendGridInitialized()) {
    console.error(`[EMAIL] SendGrid API key not configured!`);
    console.error(`[EMAIL] Please set SENDGRID_API_KEY in your .env.local file`);
    return { success: false, error: "SendGrid API key not configured. Please contact support." };
  }
  
  try {
    // Get salon name
    const salonName = await getSalonName(ownerUid);
    
    const html = generateWelcomeEmailHTML(userName, salonName);
    const subject = `Welcome to ${salonName}! - BMS PRO PINK`;
    
    const msg = {
      to: emailAddress,
      from: FROM_EMAIL,
      subject: subject,
      html: html,
      trackingSettings: {
        clickTracking: {
          enable: false, // Disable click tracking so links go directly to destination
        },
      },
    };
    
    console.log(`[EMAIL] Sending welcome email via SendGrid:`, {
      to: emailAddress,
      from: FROM_EMAIL,
      subject: subject,
      salonName: salonName,
    });
    
    await sgMail.send(msg);
    
    console.log(`[EMAIL] ✅ Welcome email sent successfully to ${emailAddress}`);
    return { success: true };
  } catch (error: any) {
    console.error(`[EMAIL] ❌ Error sending welcome email to ${emailAddress}:`, error);
    console.error(`[EMAIL] Error details:`, {
      message: error?.message,
      code: error?.code,
      response: error?.response?.body,
      statusCode: error?.response?.statusCode,
    });
    const errorMessage = error?.response?.body?.errors?.[0]?.message || error?.message || "Unknown error";
    return { success: false, error: errorMessage };
  }
}
