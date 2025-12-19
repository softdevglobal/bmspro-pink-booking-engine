import { adminDb } from "./firebaseAdmin";

/**
 * Cache for owner validation to avoid repeated database lookups
 * Entries expire after 5 minutes
 */
interface CacheEntry {
  exists: boolean;
  isActive: boolean;
  timestamp: number;
}

const ownerCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ownerCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      ownerCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

export interface OwnerValidationResult {
  valid: boolean;
  error?: string;
  ownerData?: {
    salonName?: string;
    status?: string;
  };
}

/**
 * Validate that an ownerUid corresponds to a valid, active salon owner
 * 
 * @param ownerUid - The owner UID to validate
 * @returns OwnerValidationResult indicating if the owner is valid
 */
export async function validateOwnerUid(ownerUid: string): Promise<OwnerValidationResult> {
  if (!ownerUid || typeof ownerUid !== "string" || ownerUid.trim() === "") {
    return {
      valid: false,
      error: "Invalid ownerUid format",
    };
  }

  const trimmedUid = ownerUid.trim();

  // Check cache first
  const cached = ownerCache.get(trimmedUid);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    if (!cached.exists) {
      return {
        valid: false,
        error: "Salon not found",
      };
    }
    if (!cached.isActive) {
      return {
        valid: false,
        error: "Salon is not active",
      };
    }
    return { valid: true };
  }

  try {
    const db = adminDb();
    const ownerDoc = await db.doc(`users/${trimmedUid}`).get();

    if (!ownerDoc.exists) {
      // Cache the negative result
      ownerCache.set(trimmedUid, {
        exists: false,
        isActive: false,
        timestamp: Date.now(),
      });
      return {
        valid: false,
        error: "Salon not found",
      };
    }

    const ownerData = ownerDoc.data();
    const role = (ownerData?.role || "").toString().toLowerCase();
    
    // Check if the user is a salon owner
    const validRoles = ["salon_owner", "super_admin"];
    if (!validRoles.includes(role)) {
      ownerCache.set(trimmedUid, {
        exists: true,
        isActive: false,
        timestamp: Date.now(),
      });
      return {
        valid: false,
        error: "Invalid salon owner",
      };
    }

    // Check if the account is active (not suspended)
    const status = (ownerData?.status || "active").toString().toLowerCase();
    if (status === "suspended" || status === "disabled" || status === "inactive") {
      ownerCache.set(trimmedUid, {
        exists: true,
        isActive: false,
        timestamp: Date.now(),
      });
      return {
        valid: false,
        error: "Salon is currently unavailable",
      };
    }

    // Cache the positive result
    ownerCache.set(trimmedUid, {
      exists: true,
      isActive: true,
      timestamp: Date.now(),
    });

    return {
      valid: true,
      ownerData: {
        salonName: ownerData?.salonName || ownerData?.name || ownerData?.businessName,
        status: status,
      },
    };
  } catch (error) {
    console.error("Error validating owner:", error);
    // Don't cache errors - let it retry
    return {
      valid: false,
      error: "Unable to validate salon",
    };
  }
}

/**
 * Clear the owner cache (useful for testing or after owner updates)
 */
export function clearOwnerCache(ownerUid?: string): void {
  if (ownerUid) {
    ownerCache.delete(ownerUid);
  } else {
    ownerCache.clear();
  }
}
