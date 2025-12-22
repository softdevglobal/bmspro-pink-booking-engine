import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { validateCheckInLocation, formatDistance, isValidCoordinates } from "./geolocation";

// Check-in record type
export type StaffCheckInRecord = {
  id?: string;
  staffId: string;
  staffName: string;
  staffRole?: string;
  branchId: string;
  branchName: string;
  ownerUid: string;
  
  // Timestamps
  checkInTime: Timestamp | Date;
  checkOutTime?: Timestamp | Date | null;
  
  // Location data (staff's location at check-in)
  staffLatitude: number;
  staffLongitude: number;
  
  // Branch location (for audit)
  branchLatitude: number;
  branchLongitude: number;
  
  // Validation results
  distanceFromBranch: number; // in meters
  isWithinRadius: boolean;
  allowedRadius: number; // in meters
  
  // Status
  status: "checked_in" | "checked_out" | "auto_checked_out";
  
  // Notes
  note?: string;
  
  // Device info for security
  deviceInfo?: {
    platform?: string;
    userAgent?: string;
  };
  
  // Metadata
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type CheckInInput = {
  staffId: string;
  staffName: string;
  staffRole?: string;
  branchId: string;
  staffLatitude: number;
  staffLongitude: number;
  deviceInfo?: {
    platform?: string;
    userAgent?: string;
  };
};

export type CheckInResult = {
  success: boolean;
  message: string;
  checkInId?: string;
  distanceFromBranch?: number;
  isWithinRadius?: boolean;
  branchName?: string;
};

export type CheckOutInput = {
  staffId: string;
  checkInId: string;
};

export type CheckOutResult = {
  success: boolean;
  message: string;
  hoursWorked?: string;
};

/**
 * Perform staff check-in with location validation
 */
export async function performStaffCheckIn(
  ownerUid: string,
  input: CheckInInput
): Promise<CheckInResult> {
  try {
    // Validate coordinates
    if (!isValidCoordinates(input.staffLatitude, input.staffLongitude)) {
      return { 
        success: false, 
        message: "Invalid GPS coordinates. Please ensure location services are enabled." 
      };
    }

    // 1. Get branch data
    const branchRef = doc(db, "branches", input.branchId);
    const branchSnap = await getDoc(branchRef);
    
    if (!branchSnap.exists()) {
      return { success: false, message: "Branch not found" };
    }
    
    const branchData = branchSnap.data();
    const branchName = branchData.name || "Unknown Branch";
    
    // Verify branch belongs to owner
    if (branchData.ownerUid !== ownerUid) {
      return { success: false, message: "Unauthorized access to this branch" };
    }
    
    // 2. Check if branch has location data
    if (!branchData.location?.latitude || !branchData.location?.longitude) {
      return { 
        success: false, 
        message: "Branch location not configured. Please contact your administrator.",
        branchName
      };
    }
    
    const branchLat = branchData.location.latitude;
    const branchLon = branchData.location.longitude;
    const allowedRadius = branchData.allowedCheckInRadius || 100; // Default 100m
    
    // 3. Validate location using Haversine formula
    const validation = validateCheckInLocation(
      input.staffLatitude,
      input.staffLongitude,
      branchLat,
      branchLon,
      allowedRadius
    );
    
    // 4. Check if staff already has an active check-in
    const activeCheckInQuery = query(
      collection(db, "staff_check_ins"),
      where("staffId", "==", input.staffId),
      where("status", "==", "checked_in")
    );
    const activeCheckIns = await getDocs(activeCheckInQuery);
    
    if (!activeCheckIns.empty) {
      const existingCheckIn = activeCheckIns.docs[0].data();
      return { 
        success: false, 
        message: `You already have an active check-in at ${existingCheckIn.branchName}. Please check out first.`,
        isWithinRadius: validation.isWithinRadius,
        distanceFromBranch: validation.distanceMeters,
        branchName
      };
    }
    
    // 5. If not within radius, reject the check-in
    if (!validation.isWithinRadius) {
      return {
        success: false,
        message: `You are ${formatDistance(validation.distanceMeters)} away from ${branchName}. You must be within ${formatDistance(allowedRadius)} to check in.`,
        isWithinRadius: false,
        distanceFromBranch: validation.distanceMeters,
        branchName
      };
    }
    
    // 6. Create check-in record
    const checkInRecord: Omit<StaffCheckInRecord, "id"> = {
      staffId: input.staffId,
      staffName: input.staffName,
      staffRole: input.staffRole,
      branchId: input.branchId,
      branchName,
      ownerUid,
      checkInTime: serverTimestamp() as Timestamp,
      checkOutTime: null,
      staffLatitude: input.staffLatitude,
      staffLongitude: input.staffLongitude,
      branchLatitude: branchLat,
      branchLongitude: branchLon,
      distanceFromBranch: validation.distanceMeters,
      isWithinRadius: true,
      allowedRadius,
      status: "checked_in",
      deviceInfo: input.deviceInfo,
      createdAt: serverTimestamp() as Timestamp,
      updatedAt: serverTimestamp() as Timestamp,
    };
    
    const docRef = await addDoc(collection(db, "staff_check_ins"), checkInRecord);
    
    return {
      success: true,
      message: `Successfully checked in at ${branchName}`,
      checkInId: docRef.id,
      isWithinRadius: true,
      distanceFromBranch: validation.distanceMeters,
      branchName
    };
    
  } catch (error) {
    console.error("Check-in error:", error);
    return { 
      success: false, 
      message: "Failed to check in. Please try again." 
    };
  }
}

/**
 * Perform staff check-out
 */
export async function performStaffCheckOut(
  input: CheckOutInput
): Promise<CheckOutResult> {
  try {
    const checkInRef = doc(db, "staff_check_ins", input.checkInId);
    const checkInSnap = await getDoc(checkInRef);
    
    if (!checkInSnap.exists()) {
      return { success: false, message: "Check-in record not found" };
    }
    
    const checkInData = checkInSnap.data();
    
    // Verify the check-in belongs to this staff member
    if (checkInData.staffId !== input.staffId) {
      return { success: false, message: "Unauthorized: This check-in doesn't belong to you" };
    }
    
    // Check if already checked out
    if (checkInData.status !== "checked_in") {
      return { success: false, message: "Already checked out" };
    }
    
    await updateDoc(checkInRef, {
      checkOutTime: serverTimestamp(),
      status: "checked_out",
      updatedAt: serverTimestamp(),
    });
    
    // Calculate hours worked
    let hoursWorked = "0h 0m";
    if (checkInData.checkInTime) {
      const checkInTime = checkInData.checkInTime.toDate();
      const now = new Date();
      const diffMs = now.getTime() - checkInTime.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      hoursWorked = `${hours}h ${minutes}m`;
    }
    
    return { 
      success: true, 
      message: "Successfully checked out",
      hoursWorked
    };
  } catch (error) {
    console.error("Check-out error:", error);
    return { success: false, message: "Failed to check out. Please try again." };
  }
}

/**
 * Get active check-in for a staff member
 */
export async function getActiveCheckIn(
  staffId: string
): Promise<StaffCheckInRecord | null> {
  try {
    const q = query(
      collection(db, "staff_check_ins"),
      where("staffId", "==", staffId),
      where("status", "==", "checked_in")
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return null;
    
    const docData = snapshot.docs[0];
    return { id: docData.id, ...docData.data() } as StaffCheckInRecord;
  } catch (error) {
    console.error("Error getting active check-in:", error);
    return null;
  }
}

/**
 * Get staff's check-in history
 */
export async function getStaffCheckInHistory(
  staffId: string,
  limit: number = 30
): Promise<StaffCheckInRecord[]> {
  try {
    const q = query(
      collection(db, "staff_check_ins"),
      where("staffId", "==", staffId)
    );
    
    const snapshot = await getDocs(q);
    
    const records = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as StaffCheckInRecord))
      .sort((a, b) => {
        const timeA = a.checkInTime instanceof Timestamp ? a.checkInTime.toMillis() : 0;
        const timeB = b.checkInTime instanceof Timestamp ? b.checkInTime.toMillis() : 0;
        return timeB - timeA;
      })
      .slice(0, limit);
    
    return records;
  } catch (error) {
    console.error("Error getting check-in history:", error);
    return [];
  }
}
