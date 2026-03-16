import { Router } from "express";
import type { Request, Response } from "express";
import { createUser, authenticateUser, getDoctorProfile, getPatientProfile } from "../services/firestore";
import type { UserRole } from "../services/firestore";
import { signToken, requireAuth } from "../middleware/auth";

export const authRouter = Router();

// ----- Input validation helpers -----

const USERNAME_RE = /^[a-zA-Z0-9]{3,30}$/;

function isValidRole(value: unknown): value is UserRole {
  return value === "doctor" || value === "patient";
}

// ----- POST /api/auth/register -----

authRouter.post("/register", async (req: Request, res: Response) => {
  const { username, password, role } = req.body as {
    username?: unknown;
    password?: unknown;
    role?: unknown;
  };

  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    res.status(400).json({
      error: "Username must be 3–30 alphanumeric characters.",
      code: "INVALID_INPUT",
    });
    return;
  }

  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({
      error: "Password must be at least 8 characters.",
      code: "INVALID_INPUT",
    });
    return;
  }

  if (!isValidRole(role)) {
    res.status(400).json({
      error: "Role must be 'doctor' or 'patient'.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const user = await createUser(username, password, role);
    const token = signToken({ username: user.username, role: user.role });

    res.status(201).json({ token, username: user.username, role: user.role });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === "USERNAME_EXISTS") {
      res.status(409).json({
        error: "Username already taken.",
        code: "USERNAME_EXISTS",
      });
      return;
    }

    console.error("[auth] register error:", message.slice(0, 200));
    res.status(500).json({
      error: "Registration failed. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- POST /api/auth/login -----

authRouter.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({
      error: "username and password are required.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const user = await authenticateUser(username, password);
    const token = signToken({ username: user.username, role: user.role });

    res.json({
      token,
      username: user.username,
      role: user.role,
      displayName: user.displayName || user.username,
      gender: user.gender || "male",
      // Doctor profile fields for certificate auto-fill
      specialty: user.specialty,
      hospital: user.hospital,
      department: user.department,
      licenseNumber: user.licenseNumber,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === "INVALID_CREDENTIALS") {
      // Identical response for wrong username vs wrong password — prevents enumeration
      res.status(401).json({
        error: "Invalid username or password.",
        code: "INVALID_CREDENTIALS",
      });
      return;
    }

    console.error("[auth] login error:", message.slice(0, 200));
    res.status(500).json({
      error: "Login failed. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/auth/me -----
// Get the current user's own profile

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  try {
    if (user.role === "doctor") {
      const profile = await getDoctorProfile(user.username);
      res.json({ profile, role: "doctor" });
    } else if (user.role === "patient") {
      const profile = await getPatientProfile(user.username);
      res.json({ profile, role: "patient" });
    } else {
      // Admin - return basic info
      res.json({ profile: { username: user.username, displayName: user.username }, role: "admin" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth] me error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch profile.",
      code: "INTERNAL_ERROR",
    });
  }
});
