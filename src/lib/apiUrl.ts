/**
 * Prepends the Next.js basePath to API routes for client-side fetch() calls.
 *
 * When basePath is set in next.config.ts (e.g., "/book-now"), Next.js Link
 * and router.push handle it automatically, but fetch() does NOT.
 * This utility ensures API calls like fetch('/api/branches') become
 * fetch('/book-now/api/branches') so they get caught by the proxy rewrite.
 *
 * Usage:
 *   import { apiUrl } from "@/lib/apiUrl";
 *   const res = await fetch(apiUrl(`/api/branches?ownerUid=${uid}`));
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/book-now";

export function apiUrl(path: string): string {
  // If path already includes the basePath, don't double-prefix
  if (path.startsWith(BASE_PATH)) {
    return path;
  }
  return `${BASE_PATH}${path}`;
}
