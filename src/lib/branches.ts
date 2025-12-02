import { db } from "@/lib/firebase";
import {
  collection,
  DocumentData,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

export type BranchInput = {
  name: string;
  address: string;
  phone?: string;
  email?: string;
  staffIds?: string[];
  serviceIds?: string[];
  hours?:
    | string
    | {
        Monday?: { open?: string; close?: string; closed?: boolean };
        Tuesday?: { open?: string; close?: string; closed?: boolean };
        Wednesday?: { open?: string; close?: string; closed?: boolean };
        Thursday?: { open?: string; close?: string; closed?: boolean };
        Friday?: { open?: string; close?: string; closed?: boolean };
        Saturday?: { open?: string; close?: string; closed?: boolean };
        Sunday?: { open?: string; close?: string; closed?: boolean };
      };
  capacity?: number;
  manager?: string;
  adminStaffId?: string | null;
  status?: "Active" | "Pending" | "Closed";
};

export function subscribeBranchesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  console.log("subscribeBranchesForOwner called with ownerUid:", ownerUid);
  const q = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      console.log("Branches snapshot received:", snap.size, "documents");
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      console.log("Branches data:", docs);
      onChange(docs);
    },
    (error) => {
      console.error("Branches subscription error:", error);
      if (error.code === "permission-denied") {
        console.warn("Permission denied for branches query. Check Firestore security rules.");
        onChange([]);
      } else {
        console.error("Error in branches snapshot:", error);
        onChange([]);
      }
    }
  );
}

