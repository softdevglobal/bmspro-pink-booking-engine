import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  updateDoc,
} from "firebase/firestore";

export type Customer = {
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  ownerUid?: string; // For linking to salon owner if needed
  createdAt: any;
  updatedAt: any;
  totalBookings?: number;
  lastBookingDate?: string;
};

/**
 * Create or update a customer document in Firestore
 */
export async function createCustomerDocument(
  uid: string,
  email: string,
  fullName: string,
  phone?: string
) {
  const customerRef = doc(db, "customers", uid);
  
  // Check if customer already exists
  const existing = await getDoc(customerRef);
  
  if (existing.exists()) {
    // Update existing customer
    await updateDoc(customerRef, {
      fullName,
      phone: phone || "",
      updatedAt: serverTimestamp(),
    });
  } else {
    // Create new customer
    await setDoc(customerRef, {
      uid,
      email,
      fullName,
      phone: phone || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      totalBookings: 0,
    });
  }
}

/**
 * Get customer by UID
 */
export async function getCustomerByUid(uid: string): Promise<Customer | null> {
  try {
    const customerRef = doc(db, "customers", uid);
    const customerSnap = await getDoc(customerRef);
    
    if (customerSnap.exists()) {
      return customerSnap.data() as Customer;
    }
    return null;
  } catch (error) {
    console.error("Error fetching customer:", error);
    return null;
  }
}

/**
 * Get customer by email
 */
export async function getCustomerByEmail(email: string): Promise<Customer | null> {
  try {
    const q = query(collection(db, "customers"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return { ...doc.data(), uid: doc.id } as Customer;
    }
    return null;
  } catch (error) {
    console.error("Error fetching customer by email:", error);
    return null;
  }
}

/**
 * Update customer booking count
 */
export async function incrementCustomerBookings(uid: string) {
  try {
    const customerRef = doc(db, "customers", uid);
    const customerSnap = await getDoc(customerRef);
    
    if (customerSnap.exists()) {
      const data = customerSnap.data();
      await updateDoc(customerRef, {
        totalBookings: (data.totalBookings || 0) + 1,
        lastBookingDate: new Date().toISOString().split('T')[0],
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error("Error updating customer bookings:", error);
  }
}

