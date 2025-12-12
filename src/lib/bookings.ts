import { db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp, query, where, onSnapshot, DocumentData, getDocs } from "firebase/firestore";
import type { BookingStatus } from "./bookingTypes";

/**
 * Generate a readable booking code
 * Format: BK-YYYY-MMDDHH-NNNN (e.g., BK-2024-120215-1234)
 * Includes date/time components for better uniqueness
 */
export function generateBookingCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hour = now.getHours().toString().padStart(2, '0');
  const dateTime = `${month}${day}${hour}`;
  // Generate a 4-digit random number
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `BK-${year}-${dateTime}-${randomNum}`;
}

export type BookingInput = {
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
  serviceId: string | number;
  serviceName?: string;
  staffId?: string | null; // Optional - allows booking without specific staff
  staffName?: string;
  branchId: string;
  branchName?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration: number; // minutes
  status?: BookingStatus;
  price: number;
  ownerUid: string; // Required for booking engine
  customerUid?: string; // Customer account UID (for authenticated bookings)
  services?: Array<{
    id: string | number;
    name?: string;
    price?: number;
    duration?: number;
    time?: string;
    staffId?: string | null;
    staffName?: string | null;
    // approvalStatus will be set by admin when confirming
  }>; // Multiple services details
};

export async function createBooking(input: BookingInput): Promise<{ id: string; bookingCode?: string }> {
  try {
    // Try API route first (uses Firebase Admin SDK, bypasses security rules)
    const res = await fetch("/api/booking-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerUid: input.ownerUid,
        client: input.client,
        clientEmail: input.clientEmail || undefined,
        clientPhone: input.clientPhone || undefined,
        notes: input.notes || undefined,
        serviceId: input.serviceId,
        serviceName: input.serviceName || undefined,
        staffId: input.staffId || null,
        staffName: input.staffName || undefined,
        branchId: input.branchId,
        branchName: input.branchName || undefined,
        date: input.date,
        time: input.time,
        duration: input.duration,
        status: input.status || "Pending",
        price: input.price,
        customerUid: input.customerUid || undefined,
        services: input.services || undefined,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error || "Failed to create booking");
    }
    return { id: json.id, bookingCode: json.bookingCode };
  } catch (error) {
    console.error("Error creating booking via API:", error);
    // Fallback: try direct client write (will fail if security rules don't allow)
    const payload = {
      ownerUid: input.ownerUid,
      client: input.client,
      clientEmail: input.clientEmail || null,
      clientPhone: input.clientPhone || null,
      notes: input.notes || null,
      serviceId: typeof input.serviceId === "number" ? input.serviceId : String(input.serviceId),
      serviceName: input.serviceName || null,
      staffId: input.staffId || null,
      staffName: input.staffName || null,
      branchId: String(input.branchId),
      branchName: input.branchName || null,
      date: String(input.date),
      time: String(input.time),
      duration: Number(input.duration) || 0,
      status: input.status || "Pending",
      price: Number(input.price) || 0,
      customerUid: input.customerUid || null,
      services: input.services || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // Save to bookings collection
    const ref = await addDoc(collection(db, "bookings"), payload as any);
    return { id: ref.id };
  }
}

/**
 * Fetch bookings for a specific owner and date
 * Checks both "bookings" and "bookingRequests" collections
 */
export async function fetchBookingsForOwnerAndDate(ownerUid: string, date: string) {
  try {
    // Fetch from both collections
    const q1 = query(
      collection(db, "bookings"),
      where("ownerUid", "==", ownerUid),
      where("date", "==", date)
    );
    const q2 = query(
      collection(db, "bookingRequests"),
      where("ownerUid", "==", ownerUid),
      where("date", "==", date)
    );

    const [snapshot1, snapshot2] = await Promise.all([
      getDocs(q1).catch(() => ({ docs: [] })),
      getDocs(q2).catch(() => ({ docs: [] }))
    ]);

    // Merge results from both collections
    const bookings = snapshot1.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const bookingRequests = snapshot2.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    
    // Remove duplicates by id
    const merged = [...bookings, ...bookingRequests];
    const unique = merged.filter((item, index, self) => 
      index === self.findIndex((t) => t.id === item.id)
    );
    
    return unique;
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return [];
  }
}

/**
 * Subscribe to real-time bookings updates for an owner and date
 * Checks both "bookings" and "bookingRequests" collections to prevent double-booking
 */
export function subscribeBookingsForOwnerAndDate(
  ownerUid: string,
  date: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  let bookingsData: Array<{ id: string } & DocumentData> = [];
  let bookingRequestsData: Array<{ id: string } & DocumentData> = [];

  const mergeAndNotify = () => {
    // Merge both collections, removing duplicates by id
    const merged = [...bookingsData, ...bookingRequestsData];
    const unique = merged.filter((item, index, self) => 
      index === self.findIndex((t) => t.id === item.id)
    );
    onChange(unique);
  };

  // Subscribe to bookings collection
  const q1 = query(
    collection(db, "bookings"),
    where("ownerUid", "==", ownerUid),
    where("date", "==", date)
  );
  const unsub1 = onSnapshot(
    q1,
    (snap) => {
      bookingsData = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      mergeAndNotify();
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for bookings query.");
        bookingsData = [];
        mergeAndNotify();
      } else {
        console.error("Error in bookings snapshot:", error);
        bookingsData = [];
        mergeAndNotify();
      }
    }
  );

  // Subscribe to bookingRequests collection (silent fallback for permission errors)
  const q2 = query(
    collection(db, "bookingRequests"),
    where("ownerUid", "==", ownerUid),
    where("date", "==", date)
  );
  const unsub2 = onSnapshot(
    q2,
    (snap) => {
      bookingRequestsData = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      mergeAndNotify();
    },
    (error) => {
      if (error.code === "permission-denied") {
        // Silently ignore permission errors for customer booking engine
        // Customers don't need access to bookingRequests, only confirmed bookings
        bookingRequestsData = [];
        mergeAndNotify();
      } else {
        console.error("Error in bookingRequests snapshot:", error);
        bookingRequestsData = [];
        mergeAndNotify();
      }
    }
  );

  // Return unsubscribe function that cleans up both subscriptions
  return () => {
    unsub1();
    unsub2();
  };
}

