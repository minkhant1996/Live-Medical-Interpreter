/**
 * Analytics Service
 * Core service for tracking usage, costs, and metrics
 *
 * Features:
 * - Buffered writes (non-blocking, batched)
 * - Session lifecycle management
 * - Image tracking with GCS (production) or local storage (dev)
 * - Cost calculation and aggregation
 */

import { Firestore, Timestamp, FieldValue } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import type {
  AnalyticsEvent,
  SessionMetrics,
  AgentId,
  EventType,
  TrackGeminiCallParams,
  TrackTtsCallParams,
  TrackLiveSessionParams,
  TrackLiveAgentCallParams,
  LiveAgentCall,
  StartSessionParams,
  TrackImageParams,
  FeaturesUsed,
  AgentTiming,
} from "./types";
import { calculateTokenCost, calculateTtsCost, trackSpending } from "./pricing";

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

const BUFFER_FLUSH_INTERVAL_MS = 5000;  // Flush every 5 seconds
const MAX_BUFFER_SIZE = 100;            // Or when buffer hits 100 events
const MAX_ERROR_MSG_LENGTH = 500;       // Truncate error messages

// Skip all cloud services when using memory store (local dev)
const USE_MEMORY_STORE = process.env.USE_MEMORY_STORE === "true";

// GCS bucket for production image storage (set GCS_BUCKET env var to enable)
const GCS_BUCKET = process.env.GCS_BUCKET;
const USE_GCS = !!GCS_BUCKET && !USE_MEMORY_STORE;

// Local image storage base path (fallback for development)
const IMAGE_STORAGE_BASE = process.env.IMAGE_STORAGE_PATH ||
  path.join(process.cwd(), "analytics_images");

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS SERVICE CLASS
// ══════════════════════════════════════════════════════════════════════════════

class AnalyticsService {
  private db: Firestore | null = null;
  private dbAvailable = false;
  private gcs: Storage | null = null;
  private eventBuffer: AnalyticsEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private sessionTimers = new Map<string, number>();
  private isShuttingDown = false;
  private isFlushingBuffer = false;  // Mutex to prevent concurrent flushes

  constructor() {
    // Skip cloud services when using memory store (local dev without GCP credentials)
    if (USE_MEMORY_STORE) {
      console.log("[Analytics] Running in memory-only mode (USE_MEMORY_STORE=true)");
      this.db = null;
      this.dbAvailable = false;
      this.gcs = null;
      this.ensureImageStorageDir();
      console.log(`[Analytics] Local storage enabled (path: ${IMAGE_STORAGE_BASE})`);
      this.startFlushTimer();
      console.log("[Analytics] Service initialized (memory mode)");
      return;
    }

    // Try to initialize Firestore, but don't crash if credentials are missing
    try {
      this.db = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || "med-interpreter-dev",
        ignoreUndefinedProperties: true,
      });
      this.dbAvailable = true;
    } catch (err) {
      console.warn("[Analytics] Firestore not available, analytics will be in-memory only");
      this.db = null;
      this.dbAvailable = false;
    }

    // Initialize GCS if bucket is configured
    if (USE_GCS) {
      try {
        this.gcs = new Storage({
          projectId: process.env.GOOGLE_CLOUD_PROJECT || "med-interpreter-dev",
        });
        console.log(`[Analytics] GCS storage enabled (bucket: ${GCS_BUCKET})`);
      } catch (err) {
        console.warn("[Analytics] GCS not available, using local storage");
        this.gcs = null;
      }
    }

    if (!USE_GCS) {
      this.ensureImageStorageDir();
      console.log(`[Analytics] Local storage enabled (path: ${IMAGE_STORAGE_BASE})`);
    }

    this.startFlushTimer();
    console.log("[Analytics] Service initialized");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BUFFER MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushBuffer().catch((err) => {
        console.error("[Analytics] Background flush failed:", err);
      });
    }, BUFFER_FLUSH_INTERVAL_MS);
  }

  private async flushBuffer(): Promise<void> {
    // Prevent concurrent flushes (race condition guard)
    if (this.isFlushingBuffer || this.eventBuffer.length === 0) return;

    // If no database, just clear the buffer (in-memory only mode)
    if (!this.db) {
      const count = this.eventBuffer.length;
      this.eventBuffer = [];
      if (count > 0) {
        console.log(`[Analytics] Cleared ${count} events (no database)`);
      }
      return;
    }

    this.isFlushingBuffer = true;

    try {
      const batch = this.db.batch();
      // Take events atomically while holding the lock
      const events = this.eventBuffer.splice(0, MAX_BUFFER_SIZE);

      for (const event of events) {
        const docRef = this.db.collection("analytics_events").doc(event.eventId);
        batch.set(docRef, {
          ...event,
          timestamp: Timestamp.fromDate(event.timestamp),
        });
      }

      try {
        await batch.commit();
        console.log(`[Analytics] Flushed ${events.length} events`);
      } catch (err) {
        // Check if it's an auth error
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("credentials") || errMsg.includes("authentication")) {
          console.warn("[Analytics] Firestore auth failed, switching to in-memory mode");
          this.db = null;
          this.dbAvailable = false;
        } else {
          console.error("[Analytics] Flush failed:", err);
          // Re-add failed events to buffer (with limit to prevent infinite growth)
          if (this.eventBuffer.length < 1000 && !this.isShuttingDown) {
            this.eventBuffer.unshift(...events);
          }
        }
      }
    } finally {
      this.isFlushingBuffer = false;
    }
  }

  private bufferEvent(event: AnalyticsEvent): void {
    this.eventBuffer.push(event);

    // Flush immediately if buffer is full
    if (this.eventBuffer.length >= MAX_BUFFER_SIZE) {
      this.flushBuffer().catch(console.error);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GEMINI API TRACKING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Track a Gemini API call
   */
  trackGeminiCall(params: TrackGeminiCallParams): string {
    const costUsd = calculateTokenCost(
      params.model,
      params.inputTokens,
      params.outputTokens
    );

    // Debug logging
    console.log(`[Analytics] trackGeminiCall: session=${params.sessionId}, model=${params.model}, tokens=${params.inputTokens}/${params.outputTokens}, cost=$${costUsd.toFixed(6)}`);

    // Track spending for budget alerts
    trackSpending(costUsd);

    const eventId = uuidv4();
    const event: AnalyticsEvent = {
      eventId,
      eventType: this.operationToEventType(params.operation),
      timestamp: new Date(),
      userId: params.userId,
      sessionId: params.sessionId,
      roomCode: params.roomCode || null,
      agent: params.agent,
      operation: params.operation,
      // NOTE: No PHI stored (systemPrompt, userPrompt, agentResponse) for HIPAA compliance
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      costUsd,
      model: params.model,
      latencyMs: params.latencyMs,
      latencyBreakdown: params.latencyBreakdown || null,
      fromLang: params.fromLang || null,
      toLang: params.toLang || null,
      inputType: params.inputType,
      inputSizeBytes: params.inputSizeBytes || 0,
      toolsUsed: params.toolsUsed || [],
      success: params.success,
      errorCode: params.errorCode || null,
      errorMessage: truncate(params.errorMessage, MAX_ERROR_MSG_LENGTH),
      metadata: params.metadata || {},
    };

    this.bufferEvent(event);
    this.updateSessionMetricsAsync(params.sessionId, event);

    return eventId;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TTS TRACKING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Track a TTS synthesis call
   */
  trackTtsCall(params: TrackTtsCallParams): string {
    const costUsd = calculateTtsCost(params.charCount, {
      isNeural: params.isNeural,
      isGeminiFallback: params.isGeminiFallback,
    });

    trackSpending(costUsd);

    const eventId = uuidv4();
    const event: AnalyticsEvent = {
      eventId,
      eventType: "tts_synthesis",
      timestamp: new Date(),
      userId: params.userId,
      sessionId: params.sessionId,
      roomCode: params.roomCode || null,
      agent: params.isGeminiFallback ? "gemini-tts" : "cloud-tts",
      operation: "synthesize_speech",
      // NOTE: No PHI stored (text content) for HIPAA compliance
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd,
      model: params.isGeminiFallback ? "gemini-2.5-flash" : "cloud-tts-neural",
      latencyMs: params.latencyMs,
      latencyBreakdown: null,
      fromLang: null,
      toLang: params.lang,
      inputType: "text",
      inputSizeBytes: params.charCount,
      toolsUsed: ["tts"],
      success: params.success,
      errorCode: params.errorCode || null,
      errorMessage: truncate(params.errorMessage, MAX_ERROR_MSG_LENGTH),
      metadata: { isNeural: params.isNeural, charCount: params.charCount },
    };

    this.bufferEvent(event);
    return eventId;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIVE AUDIO SESSION TRACKING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Track a live audio interpretation session
   */
  trackLiveSession(params: TrackLiveSessionParams): string {
    // Estimate tokens for live session
    const estimatedInputTokens = params.audioChunksProcessed * 50;
    const estimatedOutputTokens = params.turnsCompleted * 200;

    const costUsd = calculateTokenCost(
      "gemini-2.5-flash-native-audio",
      estimatedInputTokens,
      estimatedOutputTokens
    );

    trackSpending(costUsd);

    const eventId = uuidv4();
    const event: AnalyticsEvent = {
      eventId,
      eventType: "live_audio_session",
      timestamp: new Date(),
      userId: params.userId,
      sessionId: params.sessionId,
      roomCode: params.roomCode || null,
      agent: "gemini-2.5-flash-native-audio",
      operation: "live_interpret",
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      totalTokens: estimatedInputTokens + estimatedOutputTokens,
      costUsd,
      model: "models/gemini-2.5-flash-native-audio-preview",
      latencyMs: params.durationMs,
      latencyBreakdown: null,
      fromLang: params.fromLang,
      toLang: params.toLang,
      inputType: "audio",
      inputSizeBytes: params.audioChunksProcessed * 4096,
      toolsUsed: ["live_interpretation"],
      success: params.success,
      errorCode: params.success ? null : "LIVE_SESSION_ERROR",
      errorMessage: truncate(params.errorMessage, MAX_ERROR_MSG_LENGTH),
      metadata: {
        role: params.role,
        turnsCompleted: params.turnsCompleted,
        interrupted: params.interrupted,
        audioChunksProcessed: params.audioChunksProcessed,
      },
    };

    this.bufferEvent(event);
    this.updateSessionMetricsAsync(params.sessionId, event);

    return eventId;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIVE AGENT CALL TRACKING (with full prompt/response for admin)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Track a single live agent translation turn with full details
   * This stores prompts/responses for admin visibility
   */
  async trackLiveAgentCall(params: TrackLiveAgentCallParams): Promise<string> {
    const callId = uuidv4();

    const liveAgentCall: LiveAgentCall = {
      callId,
      timestamp: new Date(),
      userId: params.userId,
      username: params.username,
      sessionId: params.sessionId,
      roomCode: params.roomCode,
      speakerRole: params.speakerRole,
      speakerGender: params.speakerGender,
      voiceModel: params.voiceModel,
      fromLang: params.fromLang,
      fromLangName: params.fromLangName,
      toLang: params.toLang,
      toLangName: params.toLangName,
      systemPrompt: params.systemPrompt,
      userText: params.userText,
      responseText: params.responseText,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      processingDurationMs: params.processingDurationMs,
      costUsd: params.costUsd,
      inputAudioDurationMs: params.inputAudioDurationMs,
      outputAudioDurationMs: params.outputAudioDurationMs,
      isAudioGenerated: params.isAudioGenerated,
      success: params.success,
      errorMessage: params.errorMessage || null,
    };

    console.log(`[Analytics] trackLiveAgentCall: room=${params.roomCode}, user=${params.username}, role=${params.speakerRole}, tokens=${params.inputTokens}/${params.outputTokens}, cost=$${params.costUsd.toFixed(6)}`);

    // Store directly to Firestore (not buffered, for immediate visibility)
    if (this.db) {
      try {
        await this.db.collection("live_agent_calls").doc(callId).set({
          ...liveAgentCall,
          timestamp: Timestamp.fromDate(liveAgentCall.timestamp),
        });
        console.log(`[Analytics] Live agent call stored: ${callId}`);
      } catch (err) {
        console.error("[Analytics] Failed to store live agent call:", err);
      }
    }

    return callId;
  }

  /**
   * Get live agent calls for admin dashboard
   */
  async getLiveAgentCalls(options: {
    limit?: number;
    roomCode?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<LiveAgentCall[]> {
    if (!this.db) return [];

    const { limit = 50, roomCode, userId, startDate, endDate } = options;

    let query = this.db.collection("live_agent_calls")
      .orderBy("timestamp", "desc")
      .limit(limit);

    // Note: Firestore doesn't support multiple inequality filters on different fields
    // So we filter in memory for roomCode and userId
    const snapshot = await query.get();

    let calls = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        callId: doc.id,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
      } as LiveAgentCall;
    });

    // Filter in memory
    if (roomCode) {
      calls = calls.filter(c => c.roomCode === roomCode);
    }
    if (userId) {
      calls = calls.filter(c => c.userId === userId || c.username === userId);
    }
    if (startDate) {
      calls = calls.filter(c => c.timestamp >= startDate);
    }
    if (endDate) {
      calls = calls.filter(c => c.timestamp <= endDate);
    }

    return calls;
  }

  /**
   * Get a single live agent call by ID
   */
  async getLiveAgentCallById(callId: string): Promise<LiveAgentCall | null> {
    if (!this.db) return null;

    const doc = await this.db.collection("live_agent_calls").doc(callId).get();
    if (!doc.exists) return null;

    const data = doc.data()!;
    return {
      ...data,
      callId: doc.id,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
    } as LiveAgentCall;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SESSION LIFECYCLE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Start tracking a new session
   */
  async startSession(params: StartSessionParams): Promise<void> {
    this.sessionTimers.set(params.sessionId, Date.now());

    const initialMetrics: Partial<SessionMetrics> = {
      sessionId: params.sessionId,
      roomCode: params.roomCode,
      doctorUsername: params.doctorUsername,
      patientUsername: params.patientUsername,
      doctorLang: params.doctorLang,
      patientLang: params.patientLang,
      startedAt: new Date(),
      endedAt: null,
      durationSeconds: 0,
      totalMessages: 0,
      doctorMessages: 0,
      patientMessages: 0,
      voiceMessages: 0,
      textMessages: 0,
      imagesAnalyzed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      featuresUsed: {
        translation: false,
        liveAudio: false,
        imageAnalysis: false,
        prescriptionScan: false,
        summary: false,
        certificate: false,
        verification: false,
      },
      verificationPassed: null,
      verificationChanges: 0,
      userEditsCount: 0,
      agentTiming: {} as Record<AgentId, AgentTiming>,
      status: "active",
    };

    if (!this.db) {
      console.log(`[Analytics] Session started (in-memory): ${params.sessionId}`);
      return;
    }

    try {
      await this.db.collection("session_metrics").doc(params.sessionId).set({
        ...initialMetrics,
        startedAt: Timestamp.now(),
      });
      console.log(`[Analytics] Session started: ${params.sessionId}`);
    } catch (err) {
      console.error("[Analytics] Failed to start session:", err);
    }
  }

  /**
   * End session tracking
   */
  async endSession(
    sessionId: string,
    status: "completed" | "abandoned" = "completed"
  ): Promise<void> {
    const startTime = this.sessionTimers.get(sessionId);
    const durationSeconds = startTime
      ? Math.round((Date.now() - startTime) / 1000)
      : 0;

    this.sessionTimers.delete(sessionId);

    if (!this.db) {
      console.log(`[Analytics] Session ended (in-memory): ${sessionId} (${status}, ${durationSeconds}s)`);
      await this.flushBuffer();
      return;
    }

    try {
      await this.db.collection("session_metrics").doc(sessionId).update({
        endedAt: Timestamp.now(),
        durationSeconds,
        status,
      });
      console.log(`[Analytics] Session ended: ${sessionId} (${status})`);
    } catch (err) {
      console.error("[Analytics] Failed to end session:", err);
    }

    // Flush any pending events
    await this.flushBuffer();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMAGE TRACKING
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Store image and track it
   * Uses GCS in production (when GCS_BUCKET is set) or local storage in development
   */
  async trackImage(params: TrackImageParams): Promise<string> {
    const imageId = uuidv4();
    const date = new Date().toISOString().slice(0, 10);
    const ext = params.mimeType.split("/")[1] || "jpg";
    const filename = `${imageId}_${params.purpose}.${ext}`;
    const imageBuffer = Buffer.from(params.imageBase64, "base64");

    let storagePath: string;

    try {
      if (USE_GCS && this.gcs && GCS_BUCKET) {
        // Upload to Google Cloud Storage
        const gcsPath = `images/${params.userId}/${date}/${filename}`;
        const bucket = this.gcs.bucket(GCS_BUCKET);
        const file = bucket.file(gcsPath);

        await file.save(imageBuffer, {
          contentType: params.mimeType,
          metadata: {
            userId: params.userId,
            sessionId: params.sessionId,
            purpose: params.purpose,
            imageId,
          },
        });

        storagePath = `gs://${GCS_BUCKET}/${gcsPath}`;
        console.log(`[Analytics] Image uploaded to GCS: ${storagePath}`);
      } else {
        // Save to local storage (development fallback)
        const userDir = path.join(IMAGE_STORAGE_BASE, params.userId, date);
        await fs.promises.mkdir(userDir, { recursive: true });
        storagePath = path.join(userDir, filename);
        await fs.promises.writeFile(storagePath, imageBuffer);
        console.log(`[Analytics] Image saved locally: ${storagePath}`);
      }

      // Store reference in Firestore (if available)
      if (this.db) {
        await this.db.collection("images").add({
          imageId,
          userId: params.userId,
          sessionId: params.sessionId,
          roomCode: params.roomCode || null,
          storagePath,
          uploadedAt: Timestamp.now(),
          mimeType: params.mimeType,
          sizeBytes: imageBuffer.length,
          analysisEventId: params.analysisEventId,
          purpose: params.purpose,
          storageType: USE_GCS ? "gcs" : "local",
        });
      }

      return storagePath;
    } catch (err) {
      console.error("[Analytics] Failed to save image:", err);
      throw err;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SESSION METRICS UPDATE (Async, non-blocking)
  // ════════════════════════════════════════════════════════════════════════════

  private updateSessionMetricsAsync(
    sessionId: string,
    event: AnalyticsEvent
  ): void {
    // Fire and forget - don't await
    this.updateSessionMetrics(sessionId, event).catch((err) => {
      console.error("[Analytics] Session metrics update failed:", err);
    });
  }

  private async updateSessionMetrics(
    sessionId: string,
    event: AnalyticsEvent
  ): Promise<void> {
    if (!this.db) {
      console.log(`[Analytics] updateSessionMetrics skipped - no database`);
      return;
    }

    console.log(`[Analytics] updateSessionMetrics: session=${sessionId}, cost=$${event.costUsd.toFixed(6)}, tokens=${event.inputTokens}/${event.outputTokens}`);

    const sessionRef = this.db.collection("session_metrics").doc(sessionId);

    const updates: Record<string, any> = {
      totalInputTokens: FieldValue.increment(event.inputTokens),
      totalOutputTokens: FieldValue.increment(event.outputTokens),
      totalCostUsd: FieldValue.increment(event.costUsd),
    };

    // Update feature usage flags based on event type
    switch (event.eventType) {
      case "translation":
        updates["featuresUsed.translation"] = true;
        updates.totalMessages = FieldValue.increment(1);
        if (event.inputType === "text") {
          updates.textMessages = FieldValue.increment(1);
        }
        break;

      case "live_audio_session":
        updates["featuresUsed.liveAudio"] = true;
        updates.voiceMessages = FieldValue.increment(1);
        break;

      case "image_analysis":
        updates["featuresUsed.imageAnalysis"] = true;
        updates.imagesAnalyzed = FieldValue.increment(1);
        break;

      case "prescription_scan":
        updates["featuresUsed.prescriptionScan"] = true;
        break;

      case "summary_generation":
        updates["featuresUsed.summary"] = true;
        break;

      case "certificate_generation":
        updates["featuresUsed.certificate"] = true;
        break;

      case "verification":
        updates["featuresUsed.verification"] = true;
        break;
    }

    // Update agent timing
    const agentKey = `agentTiming.${event.agent}`;
    // Note: Firestore doesn't support nested increments easily,
    // so we do a simple increment on a flattened path
    updates[`${agentKey}.calls`] = FieldValue.increment(1);
    updates[`${agentKey}.totalLatencyMs`] = FieldValue.increment(event.latencyMs);
    updates[`${agentKey}.totalInputTokens`] = FieldValue.increment(event.inputTokens);
    updates[`${agentKey}.totalOutputTokens`] = FieldValue.increment(event.outputTokens);
    updates[`${agentKey}.totalCostUsd`] = FieldValue.increment(event.costUsd);

    try {
      await sessionRef.update(updates);
      console.log(`[Analytics] Session ${sessionId} updated successfully`);
    } catch (err) {
      // Session might not exist yet; try to create it
      if ((err as any).code === 5) {
        // NOT_FOUND
        console.log(`[Analytics] Session ${sessionId} not found, skipping update`);
      } else {
        console.error(`[Analytics] Session ${sessionId} update failed:`, err);
        throw err;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // QUERY METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get session metrics by ID
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
    if (!this.db) return null;
    const doc = await this.db.collection("session_metrics").doc(sessionId).get();
    if (!doc.exists) return null;
    return doc.data() as SessionMetrics;
  }

  /**
   * Get events for a session
   */
  async getSessionEvents(sessionId: string): Promise<AnalyticsEvent[]> {
    if (!this.db) return [];
    const snapshot = await this.db
      .collection("analytics_events")
      .where("sessionId", "==", sessionId)
      .orderBy("timestamp", "asc")
      .get();

    return snapshot.docs.map((doc) => doc.data() as AnalyticsEvent);
  }

  /**
   * Get user's total usage
   */
  async getUserMetrics(userId: string): Promise<{
    totalSessions: number;
    totalMessages: number;
    totalCostUsd: number;
    totalTokens: number;
  }> {
    if (!this.db) {
      return { totalSessions: 0, totalMessages: 0, totalCostUsd: 0, totalTokens: 0 };
    }

    const snapshot = await this.db
      .collection("analytics_events")
      .where("userId", "==", userId)
      .select("costUsd", "totalTokens", "sessionId")
      .get();

    const sessions = new Set<string>();
    let totalCostUsd = 0;
    let totalTokens = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      sessions.add(data.sessionId);
      totalCostUsd += data.costUsd || 0;
      totalTokens += data.totalTokens || 0;
    });

    return {
      totalSessions: sessions.size,
      totalMessages: snapshot.size,
      totalCostUsd,
      totalTokens,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  private operationToEventType(operation: string): EventType {
    const mapping: Record<string, EventType> = {
      translate: "translation",
      translate_text: "translation",
      translate_streaming: "translation",
      transcribe: "transcription",
      live_interpret: "live_audio_session",
      analyze_image: "image_analysis",
      image_analysis: "image_analysis",
      analyze_prescription: "prescription_scan",
      prescription_scan: "prescription_scan",
      generate_summary: "summary_generation",
      summary: "summary_generation",
      generate_certificate: "certificate_generation",
      certificate: "certificate_generation",
      verify_summary: "verification",
      verification: "verification",
      synthesize_speech: "tts_synthesis",
      tts: "tts_synthesis",
    };

    return mapping[operation.toLowerCase()] || "translation";
  }

  private ensureImageStorageDir(): void {
    if (!fs.existsSync(IMAGE_STORAGE_BASE)) {
      fs.mkdirSync(IMAGE_STORAGE_BASE, { recursive: true });
      console.log(`[Analytics] Created image storage dir: ${IMAGE_STORAGE_BASE}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Manually flush pending events
   */
  async flush(): Promise<void> {
    await this.flushBuffer();
  }

  /**
   * Graceful shutdown - flush all pending events
   */
  async shutdown(): Promise<void> {
    console.log("[Analytics] Shutting down...");
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    while (this.eventBuffer.length > 0) {
      await this.flushBuffer();
    }

    console.log("[Analytics] Shutdown complete");
  }

  /**
   * Get buffer status (for monitoring)
   */
  getBufferStatus(): { pending: number; activeSessions: number } {
    return {
      pending: this.eventBuffer.length,
      activeSessions: this.sessionTimers.size,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function truncate(str: string | undefined | null, maxLength: number): string | null {
  if (!str) return null;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

// ══════════════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export const analytics = new AnalyticsService();

// Also export the class for testing
export { AnalyticsService };
