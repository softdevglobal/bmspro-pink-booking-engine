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
  ownerUid: string; // Required - links customer to specific salon
  createdAt: any;
  updatedAt: any;
  totalBookings?: number;
  lastBookingDate?: string;
};

/**
 * Create or update a salon-specific customer document in Firestore
 * Structure: owners/{ownerUid}/customers/{customerUid}
 */
export async function createCustomerDocument(
  ownerUid: string,
  uid: string,
  email: string,
  fullName: string,
  phone?: string
) {
  if (!ownerUid) {
    throw new Error("ownerUid is required for salon-specific customer creation");
  }
  
  const customerRef = doc(db, "owners", ownerUid, "customers", uid);
  
  // Check if customer already exists for this salon
  const existing = await getDoc(customerRef);
  
  if (existing.exists()) {
    // Update existing customer
    await updateDoc(customerRef, {
      fullName,
      phone: phone || "",
      updatedAt: serverTimestamp(),
    });
  } else {
    // Create new salon-specific customer
    await setDoc(customerRef, {
      uid,
      email,
      fullName,
      phone: phone || "",
      ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      totalBookings: 0,
    });
  }
}

/**
 * Get salon-specific customer by UID
 * Structure: owners/{ownerUid}/customers/{customerUid}
 */
export async function getCustomerByUid(ownerUid: string, uid: string): Promise<Customer | null> {
  if (!ownerUid) {
    console.error("ownerUid is required for salon-specific customer lookup");
    return null;
  }
  
  try {
    const customerRef = doc(db, "owners", ownerUid, "customers", uid);
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
 * Get salon-specific customer by email
 * Structure: owners/{ownerUid}/customers/{...}
 */
export async function getCustomerByEmail(ownerUid: string, email: string): Promise<Customer | null> {
  if (!ownerUid) {
    console.error("ownerUid is required for salon-specific customer lookup");
    return null;
  }
  
  try {
    const customersRef = collection(db, "owners", ownerUid, "customers");
    const q = query(customersRef, where("email", "==", email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const customerDoc = querySnapshot.docs[0];
      return { ...customerDoc.data(), uid: customerDoc.id } as Customer;
    }
    return null;
  } catch (error) {
    console.error("Error fetching customer by email:", error);
    return null;
  }
}

/**
 * Update salon-specific customer booking count
 * Structure: owners/{ownerUid}/customers/{customerUid}
 */
export async function incrementCustomerBookings(ownerUid: string, uid: string) {
  if (!ownerUid) {
    console.error("ownerUid is required for salon-specific customer update");
    return;
  }
  
  try {
    const customerRef = doc(db, "owners", ownerUid, "customers", uid);
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

