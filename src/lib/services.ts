import { db } from "@/lib/firebase";
import {
  collection,
  DocumentData,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

export type ServiceInput = {
  name: string;
  price: number;
  duration: number; // minutes
  icon?: string;
  imageUrl?: string;
  reviews?: number;
  branches: string[]; // branchIds
  staffIds: string[]; // salon_staff ids
};

export function subscribeServicesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  console.log("subscribeServicesForOwner called with ownerUid:", ownerUid);
  const q = query(collection(db, "services"), where("ownerUid", "==", ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      console.log("Services snapshot received:", snap.size, "documents");
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      console.log("Services data:", docs);
      onChange(docs);
    },
    (error) => {
      console.error("Services subscription error:", error);
      if (error.code === "permission-denied") {
        console.warn("Permission denied for services query. Check Firestore security rules.");
        onChange([]);
      } else {
        console.error("Error in services snapshot:", error);
        onChange([]);
      }
    }
  );
}

