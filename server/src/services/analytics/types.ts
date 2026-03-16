/**
 * Analytics Types & Interfaces
 * Comprehensive type definitions for usage tracking system
 */

// ══════════════════════════════════════════════════════════════════════════════
// ENUMS & CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export type EventType =
  | "translation"
  | "transcription"
  | "live_audio_session"
  | "image_analysis"
  | "prescription_scan"
  | "summary_generation"
  | "certificate_generation"
  | "verification"
  | "tts_synthesis"
  | "error";

export type AgentId =
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-native-audio"
  | "gemini-3.1-flash-lite"
  | "cloud-tts"
  | "gemini-tts";

export type InputType = "text" | "audio" | "image";

export type SessionStatus = "active" | "completed" | "abandoned";

export type ImagePurpose = "medical_image" | "prescription";

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS EVENT
// ══════════════════════════════════════════════════════════════════════════════

export interface LatencyBreakdown {
  ttfb: number;           // Time to first byte (ms)
  inference: number;      // Model inference time (ms)
  streaming: number;      // Streaming completion time (ms)
}

export interface AnalyticsEvent {
  // Identity
  eventId: string;
  eventType: EventType;
  timestamp: Date;
  userId: string;
  sessionId: string;
  roomCode: string | null;

  // Agent tracking (NO PHI - prompts/responses not stored for HIPAA compliance)
  agent: AgentId;
  operation: string;

  // Token metrics
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  // Cost
  costUsd: number;
  model: string;

  // Latency
  latencyMs: number;
  latencyBreakdown: LatencyBreakdown | null;

  // Language
  fromLang: string | null;
  toLang: string | null;

  // Input characteristics
  inputType: InputType;
  inputSizeBytes: number;

  // Tools used in this call
  toolsUsed: string[];

  // Error tracking
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;

  // Extensible metadata
  metadata: Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION METRICS
// ══════════════════════════════════════════════════════════════════════════════

export interface AgentTiming {
  calls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface FeaturesUsed {
  translation: boolean;
  liveAudio: boolean;
  imageAnalysis: boolean;
  prescriptionScan: boolean;
  summary: boolean;
  certificate: boolean;
  verification: boolean;
}

export interface SessionMetrics {
  // Identity
  sessionId: string;
  roomCode: string;
  doctorUsername: string;
  patientUsername: string;
  doctorLang: string;
  patientLang: string;

  // Timing
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;

  // Message counts
  totalMessages: number;
  doctorMessages: number;
  patientMessages: number;
  voiceMessages: number;
  textMessages: number;
  imagesAnalyzed: number;

  // Token/cost aggregates
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;

  // Features
  featuresUsed: FeaturesUsed;

  // Quality metrics
  verificationPassed: boolean | null;
  verificationChanges: number;
  userEditsCount: number;

  // Agent timing breakdown
  agentTiming: Record<AgentId, AgentTiming>;

  // Session status
  status: SessionStatus;
}

// ══════════════════════════════════════════════════════════════════════════════
// DAILY ROLLUP
// ══════════════════════════════════════════════════════════════════════════════

export interface DailyRollup {
  date: string;                      // YYYY-MM-DD

  // Counts
  totalSessions: number;
  totalUsers: number;
  totalMessages: number;
  totalEvents: number;

  // Tokens & Cost
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;

  // Performance
  avgSessionDurationSeconds: number;
  avgLatencyMs: number;
  errorRate: number;                 // 0-1

  // Feature usage
  featureUsage: Record<string, number>;

  // Language pairs
  languagePairs: Record<string, number>;  // e.g., "en-my": 15

  // Agent breakdown
  agentUsage: Record<AgentId, {
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
}

// ══════════════════════════════════════════════════════════════════════════════
// USER METRICS
// ══════════════════════════════════════════════════════════════════════════════

export interface UserMetrics {
  userId: string;
  role: "doctor" | "patient";

  // Activity
  totalSessions: number;
  totalMessages: number;
  totalTokensUsed: number;
  totalCostUsd: number;

  // Timeline
  firstSeenAt: Date;
  lastSeenAt: Date;

  // Usage patterns
  languagesUsed: string[];
  featuresUsed: string[];
  avgSessionDurationSeconds: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE TRACKING
// ══════════════════════════════════════════════════════════════════════════════

export interface ImageRecord {
  imageId: string;
  userId: string;
  sessionId: string;
  storagePath: string;              // Local path or GCS path
  uploadedAt: Date;
  mimeType: string;
  sizeBytes: number;
  analysisEventId: string;          // Reference to analytics_events doc
  purpose: ImagePurpose;
}

// ══════════════════════════════════════════════════════════════════════════════
// TRACKING PARAMS (Input types for tracking functions)
// ══════════════════════════════════════════════════════════════════════════════

export interface TrackGeminiCallParams {
  userId: string;
  sessionId: string;
  roomCode?: string;
  operation: string;
  agent: AgentId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  inputType: InputType;
  inputSizeBytes?: number;  // Optional for error cases
  fromLang?: string;
  toLang?: string;
  // NOTE: systemPrompt, userPrompt, agentResponse intentionally NOT stored for HIPAA compliance
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  toolsUsed?: string[];
  latencyBreakdown?: LatencyBreakdown;
  metadata?: Record<string, unknown>;
}

export interface TrackTtsCallParams {
  userId: string;
  sessionId: string;
  roomCode?: string;
  // NOTE: text intentionally NOT stored for HIPAA compliance
  charCount: number;
  latencyMs: number;
  lang: string;
  isNeural: boolean;
  isGeminiFallback: boolean;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface TrackLiveSessionParams {
  userId: string;
  sessionId: string;
  roomCode?: string;
  role: "doctor" | "patient";
  fromLang: string;
  toLang: string;
  durationMs: number;
  audioChunksProcessed: number;
  turnsCompleted: number;
  interrupted: boolean;
  success: boolean;
  errorMessage?: string;
}

export interface StartSessionParams {
  sessionId: string;
  roomCode: string;
  doctorUsername: string;
  patientUsername: string;
  doctorLang: string;
  patientLang: string;
}

export interface TrackImageParams {
  userId: string;
  sessionId: string;
  roomCode?: string;
  imageBase64: string;
  mimeType: string;
  purpose: ImagePurpose;
  analysisEventId?: string;  // Optional for cases where no analysis event exists
}

// ══════════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ══════════════════════════════════════════════════════════════════════════════

export interface SessionListResponse {
  sessions: (SessionMetrics & { id: string })[];
  nextCursor: string | null;
}

export interface CostBreakdownResponse {
  startDate: string;
  endDate: string;
  totalCostUsd: number;
  byModel: Record<string, {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }>;
}

export interface AnalyticsSummary {
  period: string;
  totalSessions: number;
  totalMessages: number;
  totalCostUsd: number;
  topFeatures: { feature: string; count: number }[];
  topLanguagePairs: { pair: string; count: number }[];
  errorRate: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE AGENT CALL TRACKING
// ══════════════════════════════════════════════════════════════════════════════

export interface LiveAgentCall {
  // Identity
  callId: string;
  timestamp: Date;
  userId: string;
  username: string;
  sessionId: string;
  roomCode: string;

  // Speaker info
  speakerRole: "doctor" | "patient";
  speakerGender: "male" | "female";
  voiceModel: string;  // Voice used: Charon, Kore, Puck, Aoede

  // Language
  fromLang: string;
  fromLangName: string;
  toLang: string;
  toLangName: string;

  // Prompts & Response (for admin visibility)
  systemPrompt: string;
  userText: string;        // What the speaker said (transcription)
  responseText: string;    // Translation output

  // Metrics
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  processingDurationMs: number;
  costUsd: number;

  // Audio info
  inputAudioDurationMs: number;
  outputAudioDurationMs: number;
  isAudioGenerated: boolean;  // Whether translation audio was generated

  // Status
  success: boolean;
  errorMessage: string | null;
}

export interface TrackLiveAgentCallParams {
  userId: string;
  username: string;
  sessionId: string;
  roomCode: string;
  speakerRole: "doctor" | "patient";
  speakerGender: "male" | "female";
  voiceModel: string;
  fromLang: string;
  fromLangName: string;
  toLang: string;
  toLangName: string;
  systemPrompt: string;
  userText: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  processingDurationMs: number;
  costUsd: number;
  inputAudioDurationMs: number;
  outputAudioDurationMs: number;
  isAudioGenerated: boolean;  // Whether translation audio was generated
  success: boolean;
  errorMessage?: string;
}
