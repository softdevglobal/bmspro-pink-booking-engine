/**
 * Simple in-memory rate limiter for API routes
 * 
 * Note: This is suitable for single-instance deployments.
 * For multi-instance deployments (e.g., Vercel serverless), consider using
 * Redis or Upstash for distributed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Identifier for the rate limit (e.g., "booking", "auth") */
  identifier: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number; // seconds until reset
}

/**
 * Check if a request should be rate limited
 * 
 * @param clientIdentifier - Unique identifier for the client (IP, userId, etc.)
 * @param config - Rate limit configuration
 * @returns RateLimitResult indicating if request is allowed
 */
export function checkRateLimit(
  clientIdentifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${config.identifier}:${clientIdentifier}`;
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  // Create new entry if doesn't exist or has expired
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    };
  }
  
  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);
  
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
  
  if (entry.count > config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter,
    };
  }
  
  return {
    success: true,
    remaining,
    resetTime: entry.resetTime,
  };
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header (for proxied requests) or falls back to a hash
 */
export function getClientIdentifier(req: Request): string {
  // Try to get IP from various headers
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Take the first IP if there are multiple
    return forwardedFor.split(",")[0].trim();
  }
  
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  
  // Fallback: use a combination of user agent and other headers
  const userAgent = req.headers.get("user-agent") || "unknown";
  const acceptLanguage = req.headers.get("accept-language") || "unknown";
  
  // Create a simple hash
  const combined = `${userAgent}:${acceptLanguage}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `hash:${hash}`;
}

/**
 * Pre-configured rate limiters for different endpoints
 */
export const RateLimiters = {
  /** Rate limit for booking creation: 10 bookings per 5 minutes per IP */
  booking: {
    maxRequests: 10,
    windowMs: 5 * 60 * 1000, // 5 minutes
    identifier: "booking",
  } as RateLimitConfig,
  
  /** Rate limit for auth attempts: 5 attempts per 15 minutes per IP */
  auth: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    identifier: "auth",
  } as RateLimitConfig,
  
  /** Rate limit for general API: 100 requests per minute per IP */
  general: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    identifier: "general",
  } as RateLimitConfig,
  
  /** Rate limit for registration: 3 registrations per hour per IP */
  registration: {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    identifier: "registration",
  } as RateLimitConfig,
};
