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
  bookingTime?: string
): { title: string; message: string; type: NotificationType } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const service = serviceName ? ` for ${serviceName}` : "";
  const staff = staffName ? ` with ${staffName}` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  switch (status) {
    case "Pending":
      return {
        title: "Booking Request Received",
        message: `Your booking request${code}${service} has been received successfully! We'll confirm your appointment soon.`,
        type: "booking_status_changed"
      };
    case "Confirmed":
      return {
        title: "Booking Confirmed",
        message: `Your booking${code}${service}${staff}${datetime} has been confirmed. We look forward to seeing you!`,
        type: "booking_confirmed"
      };
    case "Completed":
      return {
        title: "Booking Completed",
        message: `Your booking${code}${service}${staff} has been completed. Thank you for visiting us!`,
        type: "booking_completed"
      };
    case "Canceled":
      return {
        title: "Booking Canceled",
        message: `Your booking${code}${service}${datetime} has been canceled. Please contact us if you have any questions.`,
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

