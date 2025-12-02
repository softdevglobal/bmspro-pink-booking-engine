import { db } from "@/lib/firebase";
import {
  DocumentData,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { collection } from "firebase/firestore";

export type StaffStatus = "Active" | "Suspended";

export type StaffTraining = {
  ohs?: boolean;
  prod?: boolean;
  tool?: boolean;
};

export type WeeklySchedule = {
  Monday?: { branchId: string; branchName: string } | null;
  Tuesday?: { branchId: string; branchName: string } | null;
  Wednesday?: { branchId: string; branchName: string } | null;
  Thursday?: { branchId: string; branchName: string } | null;
  Friday?: { branchId: string; branchName: string } | null;
  Saturday?: { branchId: string; branchName: string } | null;
  Sunday?: { branchId: string; branchName: string } | null;
};

export type SalonStaffInput = {
  email?: string;
  name: string;
  role: string;
  branchId: string;
  branchName: string;
  status?: StaffStatus;
  avatar?: string;
  training?: StaffTraining;
  authUid?: string;
  systemRole?: string;
  weeklySchedule?: WeeklySchedule;
};

export function subscribeSalonStaffForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  // Subscribe to all users belonging to this owner (staff & branch admins)
  const q = query(collection(db, "users"), where("ownerUid", "==", ownerUid));
  
  return onSnapshot(
    q,
    (snap) => {
      const staffList = snap.docs
        .map((d) => {
          const data = d.data();
          return { 
            id: d.id, 
            ...data,
            // Ensure compatibility with UI which expects 'name' and 'role' (job title)
            name: data.displayName || data.name || "Unknown",
            role: data.staffRole || data.role || "Staff",
            systemRole: data.role
          }; 
        })
        .filter(u => ["salon_staff", "salon_branch_admin"].includes(u.systemRole as string));
      
      onChange(staffList);
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for staff query.");
        onChange([]);
      } else {
        console.error("Error in staff snapshot:", error);
        onChange([]);
      }
    }
  );
}

