/**
 * In-process rate limiting.
 *
 * Analysis performs outbound fetching against third-party websites, so an
 * unbounded endpoint makes the platform a nuisance to other people's servers as
 * well as an easy way to exhaust this one. A token bucket per key is enough at
 * a single instance; a shared store is the change to make when there is more
 * than one.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  options: { capacity: number; refillPerMinute: number },
  now = Date.now(),
): RateLimitResult {
  const { capacity, refillPerMinute } = options;
  const existing = buckets.get(key) ?? { tokens: capacity, updatedAt: now };

  const elapsedMinutes = (now - existing.updatedAt) / 60_000;
  const tokens = Math.min(capacity, existing.tokens + elapsedMinutes * refillPerMinute);

  if (tokens < 1) {
    const secondsPerToken = 60 / refillPerMinute;
    buckets.set(key, { tokens, updatedAt: now });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((1 - tokens) * secondsPerToken),
    };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, remaining: Math.floor(tokens - 1), retryAfterSeconds: 0 };
}

/** Tests and long-running processes; buckets are otherwise self-trimming. */
export function resetRateLimits(): void {
  buckets.clear();
}

export const ANALYSIS_LIMIT = { capacity: 10, refillPerMinute: 2 };
export const LOGIN_LIMIT = { capacity: 10, refillPerMinute: 1 };
