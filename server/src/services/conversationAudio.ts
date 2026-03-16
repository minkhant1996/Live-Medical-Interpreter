/**
 * Conversation Audio Processing
 * Stores audio in GCS, transcribes with STT v2 Chirp 3, generates summaries
 */

import { transcribeAudio, transcribeConversationAudio } from "./speechToText";
import { translateText, summarizeConversation } from "./gemini";
import {
  startConversation as gcsStartConversation,
  addAudioSegment as gcsAddAudioSegment,
  getConversationAudio,
  hasAudio as gcsHasAudio,
  getConversationDuration as gcsGetConversationDuration,
  clearConversation as gcsClearConversation,
} from "./audioStorage";

// Re-export GCS storage functions
export const startConversation = gcsStartConversation;
export const addAudioSegment = gcsAddAudioSegment;
export const hasAudio = gcsHasAudio;
export const getConversationDuration = gcsGetConversationDuration;
export const clearConversation = gcsClearConversation;

// Audio segment interface (for internal use)
interface AudioSegment {
  role: "doctor" | "patient";
  audioBase64: string;
  timestamp: number;
  fromLang: string;
  toLang: string;
}

// Transcribed segment
interface TranscribedSegment {
  role: "doctor" | "patient";
  original: string;
  translated: string;
  originalLang: string;
  translatedLang: string;
  timestamp: number;
}

// Full conversation transcript
export interface ConversationTranscript {
  segments: TranscribedSegment[];
  summary: {
    doctor: string; // Summary in doctor's language
    patient: string; // Summary in patient's language
  };
  durationMinutes: number;
}

/**
 * Combine audio segments into a single buffer, sorted by timestamp
 * Adds small silence gaps between segments for natural separation
 */
function combineAudioByTimestamp(segments: AudioSegment[]): {
  combinedAudio: string;
  segmentBoundaries: { role: "doctor" | "patient"; startMs: number; endMs: number; fromLang: string; toLang: string }[];
} {
  // Sort segments by timestamp
  const sorted = [...segments].sort((a, b) => a.timestamp - b.timestamp);

  const buffers: Buffer[] = [];
  const boundaries: { role: "doctor" | "patient"; startMs: number; endMs: number; fromLang: string; toLang: string }[] = [];

  // 16kHz 16-bit mono = 32000 bytes per second
  const BYTES_PER_MS = 32;
  const SILENCE_GAP_MS = 200; // 200ms silence between segments
  const silenceGap = Buffer.alloc(SILENCE_GAP_MS * BYTES_PER_MS, 0);

  let currentOffsetMs = 0;

  for (const segment of sorted) {
    // Add silence gap between segments (except first)
    if (buffers.length > 0) {
      buffers.push(silenceGap);
      currentOffsetMs += SILENCE_GAP_MS;
    }

    const audioBuffer = Buffer.from(segment.audioBase64, "base64");
    const durationMs = Math.round(audioBuffer.length / BYTES_PER_MS);

    boundaries.push({
      role: segment.role,
      startMs: currentOffsetMs,
      endMs: currentOffsetMs + durationMs,
      fromLang: segment.fromLang,
      toLang: segment.toLang,
    });

    buffers.push(audioBuffer);
    currentOffsetMs += durationMs;
  }

  const combined = Buffer.concat(buffers);
  console.log(`[ConvAudio] Combined ${sorted.length} segments into ${Math.round(combined.length / 1024)}KB audio (${Math.round(currentOffsetMs / 1000)}s)`);

  return {
    combinedAudio: combined.toString("base64"),
    segmentBoundaries: boundaries,
  };
}

/**
 * Process conversation - combine audio, transcribe with Chirp 3, generate summary
 * Uses batch transcription for better context and accuracy
 */
export async function processConversation(
  roomCode: string
): Promise<ConversationTranscript | null> {
  // Fetch audio from GCS
  const convData = await getConversationAudio(roomCode);
  if (!convData || convData.segments.length === 0) {
    console.log(`[ConvAudio] No audio to process for room ${roomCode}`);
    return null;
  }

  const { segments, doctorLang, patientLang } = convData;

  console.log(
    `[ConvAudio] Processing ${segments.length} segments for room ${roomCode}`
  );
  const startTime = Date.now();

  // Combine all audio by timestamp
  const { combinedAudio, segmentBoundaries } = combineAudioByTimestamp(segments);

  if (!combinedAudio) {
    console.log(`[ConvAudio] No audio to transcribe for room ${roomCode}`);
    return null;
  }

  const transcribedSegments: TranscribedSegment[] = [];

  try {
    // Batch transcribe with Chirp 3 (auto language detection)
    const expectedLangs = [doctorLang, patientLang];
    const transcriptionResults = await transcribeConversationAudio(combinedAudio, expectedLangs);

    if (transcriptionResults.length === 0) {
      // Fallback: transcribe each segment individually
      console.log(`[ConvAudio] Batch transcription returned empty, falling back to individual`);
      return await processConversationIndividual(roomCode);
    }

    // Map transcription results back to segments using time boundaries
    // For now, we'll match transcriptions to segments sequentially
    // (Chirp 3 maintains order in results)
    let transcriptIndex = 0;
    for (const boundary of segmentBoundaries) {
      if (transcriptIndex >= transcriptionResults.length) break;

      const result = transcriptionResults[transcriptIndex];
      if (!result.text || !result.text.trim()) {
        transcriptIndex++;
        continue;
      }

      // Translate to target language
      const translated = await translateText(
        result.text,
        boundary.fromLang,
        boundary.toLang
      );

      transcribedSegments.push({
        role: boundary.role,
        original: result.text,
        translated,
        originalLang: boundary.fromLang,
        translatedLang: boundary.toLang,
        timestamp: segments.find(s => s.role === boundary.role)?.timestamp || Date.now(),
      });

      console.log(
        `[ConvAudio] Segment ${transcribedSegments.length}: ${boundary.role} (${result.detectedLang || boundary.fromLang}) - "${result.text.slice(0, 50)}..."`
      );

      transcriptIndex++;
    }
  } catch (err) {
    console.error(`[ConvAudio] Batch transcription error, falling back:`, err);
    return await processConversationIndividual(roomCode);
  }

  if (transcribedSegments.length === 0) {
    console.log(`[ConvAudio] No transcribable segments for room ${roomCode}`);
    return null;
  }

  // Build conversation text for summary
  const conversationText = transcribedSegments
    .map((seg) => `${seg.role.toUpperCase()}: ${seg.original}`)
    .join("\n");

  // Generate summaries in both languages
  let doctorSummary = "";
  let patientSummary = "";

  try {
    // Summary in doctor's language
    doctorSummary = await summarizeConversation(
      conversationText,
      doctorLang
    );
    console.log(`[ConvAudio] Doctor summary: "${doctorSummary.slice(0, 100)}..."`);

    // Summary in patient's language
    patientSummary = await summarizeConversation(
      conversationText,
      patientLang
    );
    console.log(`[ConvAudio] Patient summary: "${patientSummary.slice(0, 100)}..."`);
  } catch (err) {
    console.error(`[ConvAudio] Error generating summary:`, err);
    doctorSummary = "Summary generation failed";
    patientSummary = "Summary generation failed";
  }

  const durationMinutes = gcsGetConversationDuration(roomCode);
  console.log(
    `[ConvAudio] Processed room ${roomCode} in ${Date.now() - startTime}ms, ${transcribedSegments.length} segments, ${durationMinutes} min`
  );

  return {
    segments: transcribedSegments,
    summary: {
      doctor: doctorSummary,
      patient: patientSummary,
    },
    durationMinutes,
  };
}

/**
 * Fallback: Process conversation by transcribing each segment individually
 */
async function processConversationIndividual(
  roomCode: string
): Promise<ConversationTranscript | null> {
  // Fetch audio from GCS
  const convData = await getConversationAudio(roomCode);
  if (!convData || convData.segments.length === 0) {
    return null;
  }

  const { segments, doctorLang, patientLang } = convData;

  console.log(`[ConvAudio] Fallback: Processing ${segments.length} segments individually`);
  const fallbackStartTime = Date.now();
  const transcribedSegments: TranscribedSegment[] = [];

  for (const segment of segments) {
    try {
      const original = await transcribeAudio(
        segment.audioBase64,
        segment.fromLang,
        "audio/pcm;rate=16000"
      );

      if (!original || !original.trim()) continue;

      const translated = await translateText(
        original,
        segment.fromLang,
        segment.toLang
      );

      transcribedSegments.push({
        role: segment.role,
        original,
        translated,
        originalLang: segment.fromLang,
        translatedLang: segment.toLang,
        timestamp: segment.timestamp,
      });
    } catch (err) {
      console.error(`[ConvAudio] Error processing segment:`, err);
    }
  }

  if (transcribedSegments.length === 0) return null;

  const conversationText = transcribedSegments
    .map((seg) => `${seg.role.toUpperCase()}: ${seg.original}`)
    .join("\n");

  let doctorSummary = "";
  let patientSummary = "";
  try {
    doctorSummary = await summarizeConversation(conversationText, doctorLang);
    patientSummary = await summarizeConversation(conversationText, patientLang);
  } catch {
    doctorSummary = "Summary generation failed";
    patientSummary = "Summary generation failed";
  }

  console.log(`[ConvAudio] Fallback completed in ${Date.now() - fallbackStartTime}ms`);

  return {
    segments: transcribedSegments,
    summary: { doctor: doctorSummary, patient: patientSummary },
    durationMinutes: gcsGetConversationDuration(roomCode),
  };
}

// Note: Cleanup is handled by audioStorage service
// GCS files auto-expire via lifecycle policy (24h)
