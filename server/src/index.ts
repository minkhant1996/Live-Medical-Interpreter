import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { setupWebSocket } from "./websocket";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { summaryRouter } from "./routes/summary";
import { certificateRouter } from "./routes/certificate";
import { consultationRouter } from "./routes/consultation";
import { analyticsRouter } from "./routes/analytics";
import { analytics } from "./services/analytics";
import { rateLimit } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
const server = http.createServer(app);

// Validate required env vars at startup
if (process.env.USE_VERTEX_AI !== "true" && !process.env.GOOGLE_API_KEY) {
  console.error("FATAL: Set GOOGLE_API_KEY (dev) or USE_VERTEX_AI=true (Cloud Run)");
  process.exit(1);
}

// Trust only the first proxy hop (Cloud Run's load balancer), not the full XFF chain
app.set("trust proxy", 1);

// CORS: restrict to own origin in production
// Supports comma-separated origins or "*" for all
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "*").split(",").map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    // Allow all if "*" is in the list
    if (allowedOrigins.includes("*")) return callback(null, true);
    // Allow ngrok domains for development
    if (origin.endsWith(".ngrok.app") || origin.endsWith(".ngrok.dev") || origin.endsWith(".ngrok.io")) {
      return callback(null, true);
    }
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Also allow localhost for development
    if (origin.startsWith("http://localhost:")) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "microphone=*, camera=*");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "10mb" }));

// Rate limiting: 30 requests per minute for API routes
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: "Too many requests. Please wait before trying again.",
  })
);

// Auth and room routes
app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);

// API routes
app.use("/api/summary", summaryRouter);
app.use("/api/certificate", certificateRouter);
app.use("/api/consultation", consultationRouter);
app.use("/api/analytics", analyticsRouter);

// Health check (no rate limit)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Return 404 JSON for unknown API routes
app.all("/api/*", (_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// Serve static client files in production
const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// Global error handler (must be last middleware)
app.use(errorHandler);

// WebSocket setup
setupWebSocket(server);

const PORT = process.env.PORT || 8034;
server.listen(PORT, () => {
  console.log(`MedInterpreter server running on port ${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api/health`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws/interpret`);
});

// Graceful shutdown — close WebSocket connections and clean up
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");

  // Close all active WebSocket connections
  if ((server as any).__wss) {
    const wss = (server as any).__wss;
    wss.clients.forEach((ws: any) => {
      ws.close(1001, "Server shutting down");
    });
    wss.close();
  }

  // Shutdown analytics service (flushes pending events)
  try {
    await analytics.shutdown();
    console.log("Analytics shutdown successfully");
  } catch (err) {
    console.error("Failed to shutdown analytics:", err);
  }

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.log("Forcing shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
});
