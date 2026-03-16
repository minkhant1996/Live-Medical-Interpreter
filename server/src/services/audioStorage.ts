/**
 * Audio Storage Service - GCS Bucket
 * Stores conversation audio for post-session transcription
 * Auto-expires after 24 hours for privacy
 */

import { Storage } from "@google-cloud/storage";

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
const BUCKET_NAME = process.env.AUDIO_BUCKET_NAME || `${PROJECT_ID}-medinterpreter-audio`;

// Initialize GCS client
const storage = new Storage();
let bucket = storage.bucket(BUCKET_NAME);
let bucketInitialized = false;

/**
 * Initialize bucket with lifecycle policy (auto-delete after 24h)
 */
async function initBucket(): Promise<void> {
  if (bucketInitialized) return;

  try {
    const [exists] = await bucket.exists();

    if (!exists) {
      console.log(`[AudioStorage] Creating bucket: ${BUCKET_NAME}`);
      await storage.createBucket(BUCKET_NAME, {
        location: process.env.GCP_REGION || "us-central1",
        storageClass: "STANDARD",
      });
      bucket = storage.bucket(BUCKET_NAME);
    }

    // Set lifecycle policy - delete objects after 1 day
    await bucket.setMetadata({
      lifecycle: {
        rule: [
          {
            action: { type: "Delete" },
            condition: { age: 1 }, // 1 day
          },
        ],
      },
      cors: [
        {
          origin: ["*"], // Allow all origins for signed URLs
          method: ["GET", "HEAD"],
          responseHeader: ["Content-Type", "Content-Length"],
          maxAgeSeconds: 3600,
        },
      ],
    });

    bucketInitialized = true;
    console.log(`[AudioStorage] Bucket initialized: ${BUCKET_NAME} (24h auto-expiry, CORS enabled)`);
  } catch (err) {
    console.error(`[AudioStorage] Failed to initialize bucket:`, err);
    // Continue without bucket - will use in-memory fallback
  }
}

// Initialize on module load
initBucket().catch(console.error);

/**
 * Audio segment metadata
 */
export interface AudioSegmentMeta {
  role: "doctor" | "patient";
  timestamp: number;
  fromLang: string;
  toLang: string;
  gcsPath: string;
  sizeBytes: number;
}

/**
 * Conversation metadata (stored in memory, audio in GCS)
 */
interface ConversationMeta {
  roomCode: string;
  doctorLang: string;
  patientLang: string;
  segments: AudioSegmentMeta[];
  startedAt: number;
  lastActivity: number;
  totalBytes: number;
}

// In-memory index of conversations (metadata only, audio in GCS)
const conversationIndex = new Map<string, ConversationMeta>();

// Max audio per room (~30 minutes)
const MAX_AUDIO_BYTES = 30 * 60 * 32000;

/**
 * Start a new conversation
 */
export function startConversation(
  roomCode: string,
  doctorLang: string,
  patientLang: string
): void {
  conversationIndex.set(roomCode, {
    roomCode,
    doctorLang,
    patientLang,
    segments: [],
    startedAt: Date.now(),
    lastActivity: Date.now(),
    totalBytes: 0,
  });
  console.log(`[AudioStorage] Started conversation: ${roomCode}`);
}

/**
 * Save audio segment to GCS
 * Note: Updates in-memory index FIRST (synchronously), then uploads to GCS (async)
 * This ensures hasAudio() returns true immediately, even if GCS upload is pending
 */
export async function addAudioSegment(
  roomCode: string,
  role: "doctor" | "patient",
  audioBase64: string,
  fromLang: string,
  toLang: string
): Promise<void> {
  const conv = conversationIndex.get(roomCode);
  if (!conv) {
    console.warn(`[AudioStorage] No conversation for room ${roomCode}`);
    return;
  }

  const audioBuffer = Buffer.from(audioBase64, "base64");
  const sizeBytes = audioBuffer.length;

  // Check size limit
  if (conv.totalBytes + sizeBytes > MAX_AUDIO_BYTES) {
    console.warn(`[AudioStorage] Room ${roomCode} audio limit reached`);
    return;
  }

  const timestamp = Date.now();
  const segmentIndex = conv.segments.length;
  const gcsPath = `conversations/${roomCode}/${timestamp}-${segmentIndex}-${role}.pcm`;

  // Update index FIRST (synchronously) so hasAudio() returns true immediately
  const segmentMeta: AudioSegmentMeta = {
    role,
    timestamp,
    fromLang,
    toLang,
    gcsPath,
    sizeBytes,
  };
  conv.segments.push(segmentMeta);
  conv.totalBytes += sizeBytes;
  conv.lastActivity = timestamp;

  console.log(`[AudioStorage] Queued segment ${segmentIndex}: ${gcsPath} (${Math.round(sizeBytes / 1024)}KB)`);

  // Upload to GCS asynchronously
  try {
    const file = bucket.file(gcsPath);
    await file.save(audioBuffer, {
      contentType: "audio/pcm",
      metadata: {
        role,
        fromLang,
        toLang,
        timestamp: timestamp.toString(),
        roomCode,
      },
    });
    console.log(`[AudioStorage] Uploaded segment ${segmentIndex} to GCS`);
  } catch (err) {
    console.error(`[AudioStorage] Failed to upload segment ${segmentIndex}:`, err);
    // Remove from index since upload failed
    const idx = conv.segments.indexOf(segmentMeta);
    if (idx !== -1) {
      conv.segments.splice(idx, 1);
      conv.totalBytes -= sizeBytes;
    }
  }
}

/**
 * Get all audio segments for a conversation (downloads from GCS)
 */
export async function getConversationAudio(roomCode: string): Promise<{
  segments: { role: "doctor" | "patient"; audioBase64: string; timestamp: number; fromLang: string; toLang: string }[];
  doctorLang: string;
  patientLang: string;
} | null> {
  const conv = conversationIndex.get(roomCode);
  if (!conv || conv.segments.length === 0) {
    return null;
  }

  const segments: { role: "doctor" | "patient"; audioBase64: string; timestamp: number; fromLang: string; toLang: string }[] = [];

  // Download each segment from GCS
  for (const meta of conv.segments) {
    try {
      const file = bucket.file(meta.gcsPath);
      const [buffer] = await file.download();

      segments.push({
        role: meta.role,
        audioBase64: buffer.toString("base64"),
        timestamp: meta.timestamp,
        fromLang: meta.fromLang,
        toLang: meta.toLang,
      });
    } catch (err) {
      console.error(`[AudioStorage] Failed to download ${meta.gcsPath}:`, err);
      // Continue with other segments
    }
  }

  return {
    segments,
    doctorLang: conv.doctorLang,
    patientLang: conv.patientLang,
  };
}

/**
 * Check if conversation has audio
 */
export function hasAudio(roomCode: string): boolean {
  const conv = conversationIndex.get(roomCode);
  return !!conv && conv.segments.length > 0;
}

/**
 * Get conversation duration in minutes
 */
export function getConversationDuration(roomCode: string): number {
  const conv = conversationIndex.get(roomCode);
  if (!conv) return 0;
  return Math.round((conv.lastActivity - conv.startedAt) / 60000);
}

/**
 * Clear conversation (delete from GCS and memory)
 */
export async function clearConversation(roomCode: string): Promise<void> {
  const conv = conversationIndex.get(roomCode);
  if (!conv) return;

  // Delete all segments from GCS
  for (const meta of conv.segments) {
    try {
      await bucket.file(meta.gcsPath).delete();
    } catch (err) {
      // Ignore delete errors (file may already be expired)
    }
  }

  conversationIndex.delete(roomCode);
  console.log(`[AudioStorage] Cleared conversation: ${roomCode}`);
}

/**
 * Save audio segment and return a path for playback
 * Returns API path that serves audio via our server (avoids signed URL issues)
 */
export async function saveTranscriptAudio(
  roomCode: string,
  transcriptId: string,
  audioBase64: string,
  type: "original" | "translated",
  mimeType: string
): Promise<string | null> {
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");

    // Determine file extension based on mime type
    let ext = "pcm";
    if (mimeType.includes("wav")) ext = "wav";
    else if (mimeType.includes("mp3")) ext = "mp3";
    else if (mimeType.includes("webm")) ext = "webm";

    const gcsPath = `transcripts/${roomCode}/${transcriptId}-${type}.${ext}`;
    const file = bucket.file(gcsPath);

    await file.save(audioBuffer, {
      contentType: mimeType.split(";")[0], // Remove params like rate=16000
      metadata: {
        roomCode,
        transcriptId,
        type,
        sampleRate: mimeType.includes("24000") ? "24000" : "16000",
      },
    });

    console.log(`[AudioStorage] Saved ${type} audio: ${gcsPath} (${Math.round(audioBuffer.length / 1024)}KB)`);

    // Return API path instead of signed URL (our server will proxy the audio)
    return `/api/rooms/${roomCode}/audio/${transcriptId}/${type}`;
  } catch (err) {
    console.error(`[AudioStorage] Failed to save transcript audio:`, err);
    return null;
  }
}

/**
 * Get audio from GCS for serving via API
 */
export async function getTranscriptAudio(
  roomCode: string,
  transcriptId: string,
  type: "original" | "translated"
): Promise<{ buffer: Buffer; mimeType: string; sampleRate: string } | null> {
  try {
    // Try common extensions
    for (const ext of ["pcm", "wav", "mp3", "webm"]) {
      const gcsPath = `transcripts/${roomCode}/${transcriptId}-${type}.${ext}`;
      const file = bucket.file(gcsPath);

      const [exists] = await file.exists();
      if (exists) {
        const [buffer] = await file.download();
        const [metadata] = await file.getMetadata();
        const sampleRate = String(metadata.metadata?.sampleRate || (type === "translated" ? "24000" : "16000"));
        const mimeType = `audio/pcm;rate=${sampleRate}`;

        console.log(`[AudioStorage] Retrieved ${type} audio: ${gcsPath}`);
        return { buffer, mimeType, sampleRate };
      }
    }

    console.warn(`[AudioStorage] Audio not found: ${roomCode}/${transcriptId}/${type}`);
    return null;
  } catch (err) {
    console.error(`[AudioStorage] Failed to get transcript audio:`, err);
    return null;
  }
}

/**
 * Cleanup old conversations from memory index
 * (GCS files auto-expire via lifecycle policy)
 */
const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function cleanupOldConversations(): void {
  const now = Date.now();
  for (const [roomCode, conv] of conversationIndex.entries()) {
    if (now - conv.lastActivity > CONVERSATION_TTL_MS) {
      conversationIndex.delete(roomCode);
      console.log(`[AudioStorage] Cleaned up expired index: ${roomCode}`);
    }
  }
}

// Cleanup every 30 minutes
setInterval(cleanupOldConversations, 30 * 60 * 1000);
