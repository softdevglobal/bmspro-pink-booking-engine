import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit, doc, updateDoc } from "firebase/firestore";
import type { BookingStatus } from "./bookingTypes";

export type NotificationType = "booking_confirmed" | "booking_completed" | "booking_canceled" | "booking_status_changed";

export interface Notification {
  id?: string;
  customerUid?: string; // Customer account UID (if authenticated)
  customerEmail?: string; // Customer email (fallback)
  customerPhone?: string; // Customer phone (fallback)
  bookingId: string;
  bookingCode?: string;
  type: NotificationType;
  title: string;
  message: string;
  status: BookingStatus;
  read: boolean;
  createdAt: any;
  ownerUid: string; // Salon owner UID
  // Additional booking details for richer notifications
  staffName?: string;
  serviceName?: string;
  branchName?: string;
  bookingDate?: string;
  bookingTime?: string;
  services?: Array<{ name: string; staffName?: string }>;
}

/**
 * Create a notification for a booking status change
 */
export async function createNotification(data: Omit<Notification, "id" | "createdAt" | "read">): Promise<string> {
  try {
    const payload = {
      ...data,
      read: false,
      createdAt: serverTimestamp(),
    };
    
    const ref = await addDoc(collection(db, "notifications"), payload);
    return ref.id;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Fetch notifications for a customer by UID
 */
export async function fetchNotificationsByCustomerUid(customerUid: string, limitCount: number = 50) {
  try {
    const q = query(
      collection(db, "notifications"),
      where("customerUid", "==", customerUid),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Notification));
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return [];
  }
}

/**
 * Fetch notifications for a customer by email (for non-authenticated users)
 */
export async function fetchNotificationsByEmail(email: string, limitCount: number = 50) {
  try {
    const q = query(
      collection(db, "notifications"),
      where("customerEmail", "==", email),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Notification));
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return [];
  }
}

/**
 * Fetch notifications for a customer by phone (for non-authenticated users)
 */
export async function fetchNotificationsByPhone(phone: string, limitCount: number = 50) {
  try {
    const q = query(
      collection(db, "notifications"),
      where("customerPhone", "==", phone),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Notification));
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return [];
  }
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const ref = doc(db, "notifications", notificationId);
    await updateDoc(ref, { read: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    throw error;
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    const { deleteDoc } = await import("firebase/firestore");
    const ref = doc(db, "notifications", notificationId);
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error deleting notification:", error);
    throw error;
  }
}

/**
 * Get notification title and message based on status
 */
export function getNotificationContent(
  status: BookingStatus, 
  bookingCode?: string,
  staffName?: string,
  serviceName?: string,
  bookingDate?: string,
  bookingTime?: string,
  services?: Array<{ name: string; staffName?: string }>
): { title: string; message: string; type: NotificationType } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  let serviceAndStaff = "";
  
  // Check if we have multiple services with specific staff
  if (services && services.length > 0) {
    // Format: " for Facial with John, Hair Cut with Jane"
    const parts = services.map(s => {
      const sName = s.name || "Service";
      const stName = s.staffName && s.staffName !== "Any Available" && s.staffName !== "Any Staff" ? ` with ${s.staffName}` : "";
      return `${sName}${stName}`;
    });
    serviceAndStaff = ` for ${parts.join(", ")}`;
  } else {
    // Fallback to single service/staff logic
    const service = serviceName ? ` for ${serviceName}` : "";
    // Don't show staff name in the main message if it's "Multiple Staff" or "Any Available"
    const showStaff = staffName && staffName !== "Multiple Staff" && staffName !== "Any Available" && staffName !== "Any Staff";
    const staff = showStaff ? ` with ${staffName}` : "";
    serviceAndStaff = `${service}${staff}`;
  }
  
  switch (status) {
    case "Pending":
      return {
        title: "Booking Request Received",
        message: `Your booking request${code}${serviceAndStaff} has been received successfully! We'll confirm your appointment soon.`,
        type: "booking_status_changed"
      };
    case "Confirmed":
      return {
        title: "Booking Confirmed",
        message: `Your booking${code}${serviceAndStaff}${datetime} has been confirmed. We look forward to seeing you!`,
        type: "booking_confirmed"
      };
    case "Completed":
      return {
        title: "Booking Completed",
        message: `Your booking${code}${serviceAndStaff} has been completed. Thank you for visiting us!`,
        type: "booking_completed"
      };
    case "Canceled":
      return {
        title: "Booking Canceled",
        message: `Your booking${code}${serviceAndStaff}${datetime} has been canceled. Please contact us if you have any questions.`,
        type: "booking_canceled"
      };
    default:
      return {
        title: "Booking Status Updated",
        message: `Your booking${code} status has been updated to ${status}.`,
        type: "booking_status_changed"
      };
  }
}

