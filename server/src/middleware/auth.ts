import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "../services/firestore";

// Validate JWT_SECRET at startup - no fallback allowed
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("FATAL: JWT_SECRET environment variable is required");
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error("FATAL: JWT_SECRET must be at least 32 characters");
    process.exit(1);
  }
  return secret;
}

export const JWT_SECRET = getJwtSecret();

// Reduced from 24h to 4h for PHI protection
export const JWT_EXPIRES_IN = "4h";

export interface JwtPayload {
  username: string;
  role: UserRole;
}

// Augment Express Request so downstream handlers get full type safety
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Sign a JWT for the given user payload.
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify a raw JWT string and return the decoded payload.
 * Throws a jwt.JsonWebTokenError on failure (caller decides how to handle).
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Express middleware that requires a valid Bearer JWT in the Authorization
 * header. Attaches the decoded payload to `req.user` on success.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Authorization header missing or malformed.",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({
      error: "Invalid or expired token.",
      code: "UNAUTHORIZED",
    });
  }
}
