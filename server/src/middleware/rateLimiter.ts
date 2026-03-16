import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, message } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Prefer auth-based key (avoids NATted IPs collapsing into one bucket)
    const authHeader = req.headers.authorization;
    const key = authHeader
      ? `auth:${authHeader.slice(-16)}`
      : req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        error: message || "Too many requests. Please try again later.",
        retryAfter,
      });
      return;
    }

    next();
  };
}

// WebSocket rate limiter (per-connection message throttle)
export class WSRateLimiter {
  private counts = new Map<string, { count: number; resetAt: number }>();
  private maxPerSecond: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxPerSecond = 50) {
    this.maxPerSecond = maxPerSecond;
    // Clean up stale entries every 60 seconds
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.counts) {
        if (now > entry.resetAt + 60_000) {
          this.counts.delete(key);
        }
      }
    }, 60_000);
  }

  allow(clientId: string): boolean {
    const now = Date.now();
    let entry = this.counts.get(clientId);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 1000 };
      this.counts.set(clientId, entry);
    }

    entry.count++;
    return entry.count <= this.maxPerSecond;
  }

  remove(clientId: string) {
    this.counts.delete(clientId);
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    this.counts.clear();
  }
}
