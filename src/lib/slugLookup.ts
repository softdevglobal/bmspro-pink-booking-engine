import { adminDb } from "./firebaseAdmin";

/**
 * Server-side slug resolution.
 * Looks up a salon owner by their URL slug and returns the ownerUid + basic info.
 *
 * Used by:
 *  - [slug]/page.tsx  (server component)
 *  - /api/resolve-slug (API route)
 */

export interface SlugLookupResult {
  found: boolean;
  ownerUid?: string;
  salonName?: string;
  salonData?: {
    name: string;
    slug: string;
    email: string;
    logoUrl?: string;
    locationText?: string;
    contactPhone?: string;
    status?: string;
    accountStatus?: string;
    colors?: {
      primary?: string;
      secondary?: string;
    };
  };
}

/**
 * Cache slug lookups for 5 minutes to reduce Firestore reads.
 */
const slugCache = new Map<string, { result: SlugLookupResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup expired cache entries every 10 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of slugCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL) {
        slugCache.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

/**
 * Resolve a slug to an ownerUid and salon data.
 */
export async function lookupSlug(slug: string): Promise<SlugLookupResult> {
  if (!slug || typeof slug !== "string" || slug.trim() === "") {
    return { found: false };
  }

  const normalizedSlug = slug.trim().toLowerCase();

  // Check cache first
  const cached = slugCache.get(normalizedSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  try {
    const db = adminDb();
    const snapshot = await db
      .collection("users")
      .where("slug", "==", normalizedSlug)
      .where("role", "==", "salon_owner")
      .limit(1)
      .get();

    if (snapshot.empty) {
      const result: SlugLookupResult = { found: false };
      slugCache.set(normalizedSlug, { result, timestamp: Date.now() });
      return result;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Check if the salon is active (not suspended/disabled)
    const status = (data?.status || "active").toString().toLowerCase();
    const accountStatus = (data?.accountStatus || "active").toString().toLowerCase();
    
    if (status === "suspended" || status === "disabled" || accountStatus === "suspended") {
      const result: SlugLookupResult = { found: false };
      slugCache.set(normalizedSlug, { result, timestamp: Date.now() });
      return result;
    }

    const result: SlugLookupResult = {
      found: true,
      ownerUid: doc.id,
      salonName: data?.salonName || data?.name || data?.businessName || data?.displayName || "Salon",
      salonData: {
        name: data?.salonName || data?.name || data?.businessName || "Salon",
        slug: normalizedSlug,
        email: data?.email || "",
        logoUrl: data?.logoUrl || "",
        locationText: data?.locationText || data?.address || "",
        contactPhone: data?.contactPhone || data?.phone || "",
        status: data?.status,
        accountStatus: data?.accountStatus,
        colors: data?.colors || undefined,
      },
    };

    slugCache.set(normalizedSlug, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    console.error("Error looking up slug:", error);
    return { found: false };
  }
}

/**
 * Clear the slug cache (useful for testing or after slug updates).
 */
export function clearSlugCache(slug?: string): void {
  if (slug) {
    slugCache.delete(slug.toLowerCase());
  } else {
    slugCache.clear();
  }
}
