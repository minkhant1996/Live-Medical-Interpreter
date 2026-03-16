/**
 * Analytics API Routes
 * Endpoints for querying usage data, costs, and metrics
 */

import { Router, Request, Response, NextFunction } from "express";
import { Firestore, Timestamp } from "@google-cloud/firestore";
import { requireAuth } from "../middleware/auth";
import { analytics, getDailySpend, formatCost } from "../services/analytics";

const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "med-interpreter-dev",
  ignoreUndefinedProperties: true,
});

export const analyticsRouter = Router();

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════════════════════════════

// All analytics routes require authentication
analyticsRouter.use(requireAuth);

/**
 * RBAC middleware - require admin role for sensitive endpoints
 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({
      error: "Access denied. Admin role required.",
      code: "FORBIDDEN",
    });
    return;
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function parseLimit(value: unknown, defaultVal: number, maxVal: number): number {
  const parsed = parseInt(value as string);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, maxVal);
}

function parseDays(value: unknown, defaultVal: number, maxVal: number): number {
  const parsed = parseInt(value as string);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, maxVal);
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/session/:sessionId
 * Get metrics for a specific session
 * Admins can view any session; users can only view their own
 */
analyticsRouter.get("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    // Validate sessionId format (UUID or alphanumeric)
    if (!sessionId || !/^[\w-]{1,100}$/.test(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID format" });
    }

    const doc = await db.collection("session_metrics").doc(sessionId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Non-admins can only view sessions they participated in
    if (req.user?.role !== "admin") {
      const data = doc.data();
      if (data?.doctorUsername !== req.user?.username && data?.patientUsername !== req.user?.username) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    res.json({
      id: doc.id,
      ...doc.data(),
    });
  } catch (err) {
    console.error("[Analytics] Get session error:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

/**
 * GET /api/analytics/session/:sessionId/events
 * Get all events for a session
 */
analyticsRouter.get("/session/:sessionId/events", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    // Validate sessionId format
    if (!sessionId || !/^[\w-]{1,100}$/.test(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID format" });
    }

    const limit = parseLimit(req.query.limit, 100, 500);

    const snapshot = await db
      .collection("analytics_events")
      .where("sessionId", "==", sessionId)
      .orderBy("timestamp", "asc")
      .limit(limit)
      .get();

    const events = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    console.error("[Analytics] Get session events error:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

/**
 * GET /api/analytics/sessions
 * List sessions with pagination (Admin only)
 */
analyticsRouter.get("/sessions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const cursor = req.query.cursor as string;
    const status = req.query.status as string;
    const userId = req.query.userId as string;

    let query = db
      .collection("session_metrics")
      .orderBy("startedAt", "desc")
      .limit(limit);

    // Filter by status if provided
    if (status && ["active", "completed", "abandoned"].includes(status)) {
      query = query.where("status", "==", status);
    }

    // Filter by user if provided (either doctor or patient)
    if (userId) {
      // Note: Firestore can't do OR queries easily, so we filter in memory
      // In production, you might want separate queries or denormalization
    }

    // Pagination cursor
    if (cursor) {
      const cursorDoc = await db.collection("session_metrics").doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    let sessions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter by userId in memory if needed
    if (userId) {
      sessions = sessions.filter(
        (s: any) => s.doctorUsername === userId || s.patientUsername === userId
      );
    }

    const nextCursor =
      snapshot.docs.length === limit
        ? snapshot.docs[snapshot.docs.length - 1].id
        : null;

    res.json({
      sessions,
      nextCursor,
      count: sessions.length,
    });
  } catch (err) {
    console.error("[Analytics] List sessions error:", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// COST ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/costs
 * Get cost breakdown by model and date range (Admin only)
 */
analyticsRouter.get("/costs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const defaultEnd = new Date().toISOString().slice(0, 10);

    const startDate = (req.query.start as string) || defaultStart;
    const endDate = (req.query.end as string) || defaultEnd;

    // Validate date formats
    if ((req.query.start && !isValidDate(startDate)) || (req.query.end && !isValidDate(endDate))) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    // Ensure start <= end
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ error: "Start date must be before end date." });
    }

    const startTimestamp = Timestamp.fromDate(new Date(startDate + "T00:00:00Z"));
    const endTimestamp = Timestamp.fromDate(new Date(endDate + "T23:59:59Z"));

    const snapshot = await db
      .collection("analytics_events")
      .where("timestamp", ">=", startTimestamp)
      .where("timestamp", "<=", endTimestamp)
      .select("model", "agent", "costUsd", "inputTokens", "outputTokens", "eventType")
      .get();

    const byModel: Record<
      string,
      { cost: number; inputTokens: number; outputTokens: number; calls: number }
    > = {};

    const byEventType: Record<string, { cost: number; calls: number }> = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      const model = data.model || data.agent || "unknown";
      const eventType = data.eventType || "unknown";

      // By model
      if (!byModel[model]) {
        byModel[model] = { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
      }
      byModel[model].cost += data.costUsd || 0;
      byModel[model].inputTokens += data.inputTokens || 0;
      byModel[model].outputTokens += data.outputTokens || 0;
      byModel[model].calls += 1;

      // By event type
      if (!byEventType[eventType]) {
        byEventType[eventType] = { cost: 0, calls: 0 };
      }
      byEventType[eventType].cost += data.costUsd || 0;
      byEventType[eventType].calls += 1;
    });

    const totalCost = Object.values(byModel).reduce((sum, m) => sum + m.cost, 0);
    const totalCalls = snapshot.size;

    res.json({
      startDate,
      endDate,
      totalCostUsd: Math.round(totalCost * 1000000) / 1000000,
      totalCalls,
      byModel,
      byEventType,
      formattedCost: formatCost(totalCost),
    });
  } catch (err) {
    console.error("[Analytics] Get costs error:", err);
    res.status(500).json({ error: "Failed to fetch costs" });
  }
});

/**
 * GET /api/analytics/costs/daily
 * Get daily cost breakdown (Admin only)
 */
analyticsRouter.get("/costs/daily", requireAdmin, async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days, 7, 90);

    // Build all queries in parallel for better performance
    const queries = Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().slice(0, 10);

      const startTimestamp = Timestamp.fromDate(new Date(dateStr + "T00:00:00Z"));
      const endTimestamp = Timestamp.fromDate(new Date(dateStr + "T23:59:59Z"));

      return db
        .collection("analytics_events")
        .where("timestamp", ">=", startTimestamp)
        .where("timestamp", "<=", endTimestamp)
        .select("costUsd", "totalTokens")
        .get()
        .then((snapshot) => {
          let totalCost = 0;
          let totalTokens = 0;

          snapshot.forEach((doc) => {
            const data = doc.data();
            totalCost += data.costUsd || 0;
            totalTokens += data.totalTokens || 0;
          });

          return {
            date: dateStr,
            totalCostUsd: Math.round(totalCost * 1000000) / 1000000,
            totalCalls: snapshot.size,
            totalTokens,
          };
        });
    });

    // Execute all queries in parallel
    const results = await Promise.all(queries);

    res.json({
      days,
      daily: results.reverse(), // Oldest first
      todaySpend: getDailySpend(),
    });
  } catch (err) {
    console.error("[Analytics] Get daily costs error:", err);
    res.status(500).json({ error: "Failed to fetch daily costs" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// USER ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/user/:userId
 * Get aggregated metrics for a user (Admin only, or own user)
 */
analyticsRouter.get("/user/:userId", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;

    // Validate userId format
    if (!userId || !/^[\w.-]{1,50}$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID format" });
    }

    // Non-admins can only view their own metrics
    if (req.user?.role !== "admin" && req.user?.username !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const metrics = await analytics.getUserMetrics(userId);

    res.json({
      userId,
      ...metrics,
    });
  } catch (err) {
    console.error("[Analytics] Get user metrics error:", err);
    res.status(500).json({ error: "Failed to fetch user metrics" });
  }
});

/**
 * GET /api/analytics/me
 * Get metrics for the current authenticated user
 */
analyticsRouter.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.username;
    const metrics = await analytics.getUserMetrics(userId);

    res.json({
      userId,
      role: req.user!.role,
      ...metrics,
    });
  } catch (err) {
    console.error("[Analytics] Get my metrics error:", err);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY & DASHBOARD ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/summary
 * Get overall analytics summary (Admin only)
 */
analyticsRouter.get("/summary", requireAdmin, async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || "today";

    // Validate period
    if (!["today", "week", "month"].includes(period)) {
      return res.status(400).json({ error: "Invalid period. Use 'today', 'week', or 'month'." });
    }
    let startDate: Date;

    switch (period) {
      case "today":
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
    }

    const startTimestamp = Timestamp.fromDate(startDate);

    // Get events
    const eventsSnapshot = await db
      .collection("analytics_events")
      .where("timestamp", ">=", startTimestamp)
      .select("eventType", "costUsd", "fromLang", "toLang", "success", "sessionId", "userId")
      .get();

    // Aggregate
    const sessions = new Set<string>();
    const users = new Set<string>();
    let totalCost = 0;
    let errorCount = 0;
    const featureCounts: Record<string, number> = {};
    const langPairCounts: Record<string, number> = {};

    eventsSnapshot.forEach((doc) => {
      const data = doc.data();
      sessions.add(data.sessionId);
      users.add(data.userId);
      totalCost += data.costUsd || 0;
      if (!data.success) errorCount++;

      // Feature counts
      const eventType = data.eventType || "unknown";
      featureCounts[eventType] = (featureCounts[eventType] || 0) + 1;

      // Language pair counts
      if (data.fromLang && data.toLang) {
        const pair = `${data.fromLang}-${data.toLang}`;
        langPairCounts[pair] = (langPairCounts[pair] || 0) + 1;
      }
    });

    // Sort and limit top features/pairs
    const topFeatures = Object.entries(featureCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([feature, count]) => ({ feature, count }));

    const topLanguagePairs = Object.entries(langPairCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pair, count]) => ({ pair, count }));

    res.json({
      period,
      totalSessions: sessions.size,
      totalUsers: users.size,
      totalMessages: eventsSnapshot.size,
      totalCostUsd: Math.round(totalCost * 1000000) / 1000000,
      errorRate: eventsSnapshot.size > 0 ? errorCount / eventsSnapshot.size : 0,
      topFeatures,
      topLanguagePairs,
    });
  } catch (err) {
    console.error("[Analytics] Get summary error:", err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

/**
 * GET /api/analytics/status
 * Get current analytics service status
 */
analyticsRouter.get("/status", async (req: Request, res: Response) => {
  const status = analytics.getBufferStatus();

  res.json({
    status: "ok",
    pendingEvents: status.pending,
    activeSessions: status.activeSessions,
    todaySpend: getDailySpend(),
    todaySpendFormatted: formatCost(getDailySpend()),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// LIVE AGENT CALL ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/live-agent-calls
 * List live agent calls with filtering (Admin only)
 */
analyticsRouter.get("/live-agent-calls", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const roomCode = req.query.roomCode as string;
    const userId = req.query.userId as string;

    const calls = await analytics.getLiveAgentCalls({
      limit,
      roomCode,
      userId,
    });

    res.json({
      calls,
      count: calls.length,
    });
  } catch (err) {
    console.error("[Analytics] Get live agent calls error:", err);
    res.status(500).json({ error: "Failed to fetch live agent calls" });
  }
});

/**
 * GET /api/analytics/live-agent-calls/:callId
 * Get a single live agent call by ID (Admin only)
 */
analyticsRouter.get("/live-agent-calls/:callId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const callId = req.params.callId as string;

    // Validate callId format
    if (!callId || !/^[\w-]{1,100}$/.test(callId)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    const call = await analytics.getLiveAgentCallById(callId);
    if (!call) {
      return res.status(404).json({ error: "Live agent call not found" });
    }

    res.json(call);
  } catch (err) {
    console.error("[Analytics] Get live agent call error:", err);
    res.status(500).json({ error: "Failed to fetch live agent call" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/images
 * List tracked images for a user or session (Admin only)
 */
analyticsRouter.get("/images", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const sessionId = req.query.sessionId as string;
    const limit = parseLimit(req.query.limit, 20, 100);

    // Validate userId and sessionId if provided
    if (userId && !/^[\w.-]{1,50}$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID format" });
    }
    if (sessionId && !/^[\w-]{1,100}$/.test(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID format" });
    }

    let query = db.collection("images").orderBy("uploadedAt", "desc").limit(limit);

    if (userId) {
      query = query.where("userId", "==", userId);
    }
    if (sessionId) {
      query = query.where("sessionId", "==", sessionId);
    }

    const snapshot = await query.get();
    const images = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ images, count: images.length });
  } catch (err) {
    console.error("[Analytics] Get images error:", err);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});
