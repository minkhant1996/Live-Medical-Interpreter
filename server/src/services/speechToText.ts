/**
 * Real-time Speech-to-Text using Google Cloud Speech-to-Text V2 API with Chirp
 * Features: Auto language detection, better accuracy for medical terms
 */

import { SpeechClient, protos } from "@google-cloud/speech";
import { v2 as speechV2 } from "@google-cloud/speech";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

// V2 API configuration
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
// Chirp 3 is only available in "us" region (global), NOT us-central1
const CHIRP3_LOCATION = "us";
const LOCATION = process.env.GCP_REGION || "us-central1";

// V1 client for streaming (V2 streaming is more complex)
const v1Client = new SpeechClient();

// V2 client for batch recognition with Chirp 3
// Uses "us" region which is required for Chirp 3
let v2Client: speechV2.SpeechClient | null = null;
function getV2Client(): speechV2.SpeechClient {
  if (!v2Client) {
    v2Client = new speechV2.SpeechClient({
      apiEndpoint: `${CHIRP3_LOCATION}-speech.googleapis.com`,
    });
  }
  return v2Client;
}

// Language codes for Speech-to-Text (used as hints, Chirp 3 can auto-detect)
const LANG_CODE_MAP: Record<string, string> = {
  en: "en-US",
  my: "my-MM", // Burmese
  th: "th-TH",
  zh: "cmn-Hans-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  vi: "vi-VN",
  lo: "lo-LA", // Lao
  km: "km-KH", // Khmer
};

function getLangCode(lang: string): string {
  return LANG_CODE_MAP[lang] || "en-US";
}

export class StreamingTranscriber extends EventEmitter {
  private recognizeStream: ReturnType<typeof v1Client.streamingRecognize> | null = null;
  private audioStream: PassThrough | null = null;
  private isActive = false;
  private lang: string;
  private finalTranscript = "";
  private hasError = false;
  private static sttAvailable: boolean | null = null;
  private useAutoDetect: boolean;

  constructor(lang: string, useAutoDetect: boolean = true) {
    super();
    this.lang = lang;
    this.useAutoDetect = useAutoDetect;
    // Attach a default error handler to prevent ERR_UNHANDLED_ERROR crashes
    this.on("error", (err) => {
      console.warn(`[STT] Default error handler: ${err}`);
    });
  }

  start(): void {
    if (this.isActive) return;

    if (StreamingTranscriber.sttAvailable === false) {
      console.log("[STT] Skipping start - API not available");
      return;
    }

    this.isActive = true;
    this.finalTranscript = "";
    this.hasError = false;

    // Try V2 API with Chirp 3 first, fallback to V1 if it fails
    this.startV1Streaming();
  }

  // V1 API streaming (more reliable for now)
  private startV1Streaming(): void {
    // Always use the actual language, not default en-US
    const langCode = getLangCode(this.lang);

    // For auto-detection, prioritize the primary language and add common alternatives
    // Google Speech API allows up to 3 alternative language codes
    const alternativeCodes = this.useAutoDetect
      ? [langCode, ...Object.values(LANG_CODE_MAP).filter(c => c !== langCode)].slice(0, 4)
      : [langCode];

    console.log(`[STT] Starting V1 transcriber, primary: ${langCode}, auto-detect: ${this.useAutoDetect}`);

    const config: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
      config: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: 16000,
        languageCode: langCode,
        // Enable alternative languages for better detection
        alternativeLanguageCodes: this.useAutoDetect ? alternativeCodes.slice(0, 3) : undefined,
        enableAutomaticPunctuation: true,
        // Don't specify model - let Google auto-select best for language
      },
      interimResults: true,
    };

    this.audioStream = new PassThrough();

    try {
      this.recognizeStream = v1Client
        .streamingRecognize(config)
        .on("error", (err: Error) => {
          if (!this.hasError) {
            this.hasError = true;
            console.error("[STT] Speech-to-Text error:", err.message);

            if (err.message.includes("PERMISSION_DENIED") ||
                err.message.includes("has not been used") ||
                err.message.includes("is disabled")) {
              StreamingTranscriber.sttAvailable = false;
              console.warn("[STT] Speech-to-Text API not enabled.");
            }

            // If latest_long model fails, it might be a model issue
            // Don't mark as unavailable, just log
            if (err.message.includes("model")) {
              console.warn("[STT] Model issue, transcription may not work for this language");
            }

            this.emit("error", err.message);
          }
          this.stopSilently();
        })
        .on("data", (data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse) => {
          if (this.hasError) return;

          StreamingTranscriber.sttAvailable = true;

          if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const transcript = result.alternatives?.[0]?.transcript || "";
            const detectedLang = result.languageCode;

            // Only log language detection when it differs from expected (case-insensitive)
            const expectedLang = getLangCode(this.lang).toLowerCase();
            if (detectedLang && detectedLang.toLowerCase() !== expectedLang) {
              console.log(`[STT] Detected different language: ${detectedLang} (expected: ${expectedLang})`);
            }

            if (result.isFinal) {
              this.finalTranscript += transcript + " ";
              this.emit("final", transcript);
            } else {
              this.emit("interim", transcript);
            }
          }
        })
        .on("end", () => {
          if (!this.hasError) {
            this.emit("end", this.finalTranscript.trim());
          }
        });

      this.audioStream.pipe(this.recognizeStream);
    } catch (err) {
      console.error("[STT] Failed to create recognize stream:", err);
      this.hasError = true;
      this.isActive = false;
    }
  }

  private stopSilently(): void {
    this.isActive = false;

    if (this.audioStream) {
      try { this.audioStream.end(); } catch {}
      this.audioStream = null;
    }

    if (this.recognizeStream) {
      try { this.recognizeStream.end(); } catch {}
      this.recognizeStream = null;
    }
  }

  sendAudio(base64Pcm: string): void {
    if (!this.isActive || !this.audioStream) return;

    try {
      const buffer = Buffer.from(base64Pcm, "base64");
      this.audioStream.write(buffer);
    } catch (err) {
      console.error("Error sending audio to STT:", err);
    }
  }

  stop(): string {
    this.isActive = false;

    if (this.audioStream) {
      this.audioStream.end();
      this.audioStream = null;
    }

    if (this.recognizeStream) {
      this.recognizeStream.end();
      this.recognizeStream = null;
    }

    return this.finalTranscript.trim();
  }

  getFinalTranscript(): string {
    return this.finalTranscript.trim();
  }

  isStreaming(): boolean {
    return this.isActive;
  }
}

// Batch/Synchronous transcription using V2 API with Chirp
// Better accuracy for medical terms and multi-language support
export async function transcribeAudio(
  audioBase64: string,
  lang: string,
  mimeType: string = "audio/pcm;rate=16000"
): Promise<string> {
  const langCode = getLangCode(lang);

  // Try V2 API with Chirp first, fallback to V1 if it fails
  try {
    return await transcribeWithV2(audioBase64, langCode);
  } catch (err) {
    console.warn("[STT] V2 API failed, falling back to V1:", err instanceof Error ? err.message : err);
    return await transcribeWithV1(audioBase64, lang, mimeType);
  }
}

// V2 API with Chirp 3 model - best accuracy with auto language detection
async function transcribeWithV2(audioBase64: string, langCode: string): Promise<string> {
  if (!PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID not set");
  }

  const client = getV2Client();

  // Recognizer path - use "_" for default recognizer
  // Chirp 3 requires "us" location
  const recognizer = `projects/${PROJECT_ID}/locations/${CHIRP3_LOCATION}/recognizers/_`;

  // V2 API request with Chirp 3 and auto language detection
  const request = {
    recognizer,
    config: {
      // Auto-detect audio format
      autoDecodingConfig: {},
      // Use Chirp 3 model - latest with best accuracy and 100+ languages
      model: "chirp_3",
      // Multiple language codes for auto-detection (Chirp 3 picks the best match)
      languageCodes: [langCode, "en-US", "my-MM", "th-TH", "zh-CN", "ja-JP"].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6),
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    content: Buffer.from(audioBase64, "base64"),
  };

  console.log(`[STT-V2] Transcribing ${Math.round(audioBase64.length / 1024)}KB audio with Chirp 3, hint: ${langCode}`);
  const startTime = Date.now();

  const [response] = await client.recognize(request);

  const transcript = response.results
    ?.map((r: any) => r.alternatives?.[0]?.transcript || "")
    .join(" ")
    .trim();

  // Log detected language if available
  const detectedLang = (response.results?.[0] as any)?.languageCode;
  if (detectedLang) {
    console.log(`[STT-V2] Detected language: ${detectedLang}`);
  }

  console.log(`[STT-V2] Completed in ${Date.now() - startTime}ms: "${transcript?.slice(0, 50)}..."`);
  return transcript || "";
}

// Transcribe combined conversation audio with speaker timestamps
export interface TranscriptionSegment {
  text: string;
  speakerTag?: number;
  startTime?: number;
  endTime?: number;
  detectedLang?: string;
}

export async function transcribeConversationAudio(
  audioBase64: string,
  expectedLangs: string[] = ["en-US", "my-MM"],
  sampleRate: number = 24000 // Gemini Live translated audio is 24kHz
): Promise<TranscriptionSegment[]> {
  if (!PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID not set");
  }

  // Check audio size - STT V2 has ~480 second limit for sync recognition
  // PCM 24kHz 16-bit mono = 48000 bytes/sec, so ~23MB max
  const audioSizeBytes = Buffer.from(audioBase64, "base64").length;
  const estimatedDurationSec = audioSizeBytes / (sampleRate * 2); // 16-bit = 2 bytes per sample

  if (estimatedDurationSec > 450) {
    console.warn(`[STT-V2] Audio too long (${Math.round(estimatedDurationSec)}s), truncating to ~7 minutes`);
    // Truncate to ~7 minutes (420 seconds)
    const maxBytes = 420 * sampleRate * 2;
    const truncatedBuffer = Buffer.from(audioBase64, "base64").subarray(0, maxBytes);
    audioBase64 = truncatedBuffer.toString("base64");
  }

  const client = getV2Client();
  // Chirp 3 requires "us" location
  const recognizer = `projects/${PROJECT_ID}/locations/${CHIRP3_LOCATION}/recognizers/_`;

  // Get unique language codes
  const langCodes = [...new Set(expectedLangs.map(l => getLangCode(l)))].slice(0, 6);

  // Use explicit decoding config for PCM audio (not auto-detect)
  const request = {
    recognizer,
    config: {
      // Explicit PCM decoding config instead of autoDecodingConfig
      explicitDecodingConfig: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: sampleRate,
        audioChannelCount: 1,
      },
      model: "chirp_3",
      languageCodes: langCodes,
      features: {
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
      },
    },
    content: Buffer.from(audioBase64, "base64"),
  };

  console.log(`[STT-V2] Batch transcribing conversation (${Math.round(audioBase64.length / 1024)}KB, ${Math.round(estimatedDurationSec)}s), langs: ${langCodes.join(", ")}`);
  const startTime = Date.now();

  const [response] = await client.recognize(request);

  const segments: TranscriptionSegment[] = [];
  for (const result of response.results || []) {
    const alt = (result as any).alternatives?.[0];
    if (alt?.transcript) {
      segments.push({
        text: alt.transcript,
        detectedLang: (result as any).languageCode,
        startTime: alt.words?.[0]?.startOffset ? parseFloat(alt.words[0].startOffset.replace("s", "")) : undefined,
        endTime: alt.words?.[alt.words.length - 1]?.endOffset ? parseFloat(alt.words[alt.words.length - 1].endOffset.replace("s", "")) : undefined,
      });
    }
  }

  console.log(`[STT-V2] Batch transcription completed in ${Date.now() - startTime}ms, ${segments.length} segments`);
  return segments;
}

// V1 API fallback
async function transcribeWithV1(
  audioBase64: string,
  lang: string,
  mimeType: string
): Promise<string> {
  const rateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 16000;

  let encoding: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding;
  if (mimeType.includes("pcm") || mimeType.includes("wav") || mimeType.includes("l16")) {
    encoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16;
  } else if (mimeType.includes("mp3")) {
    encoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.MP3;
  } else if (mimeType.includes("ogg") || mimeType.includes("opus")) {
    encoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.OGG_OPUS;
  } else {
    encoding = protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16;
  }

  const langCode = getLangCode(lang);
  const alternativeCodes = Object.values(LANG_CODE_MAP).filter(c => c !== langCode).slice(0, 3);

  const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
    config: {
      encoding,
      sampleRateHertz: sampleRate,
      languageCode: langCode,
      alternativeLanguageCodes: alternativeCodes,
      enableAutomaticPunctuation: true,
      model: "latest_long",
    },
    audio: {
      content: audioBase64,
    },
  };

  console.log(`[STT-V1] Fallback transcribing ${Math.round(audioBase64.length / 1024)}KB audio, lang: ${langCode}`);
  const startTime = Date.now();

  const [response] = await v1Client.recognize(request);
  const transcript = response.results
    ?.map((r) => r.alternatives?.[0]?.transcript || "")
    .join(" ")
    .trim();

  console.log(`[STT-V1] Completed in ${Date.now() - startTime}ms: "${transcript?.slice(0, 50)}..."`);
  return transcript || "";
}

// Audio buffer for accumulating chunks before batch transcription
export class AudioBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxBytes = 10 * 1024 * 1024; // 10MB max (~5 minutes of audio)

  addChunk(base64Pcm: string): void {
    const buffer = Buffer.from(base64Pcm, "base64");
    if (this.totalBytes + buffer.length > this.maxBytes) {
      console.warn("[AudioBuffer] Max size reached, dropping oldest chunks");
      while (this.chunks.length > 0 && this.totalBytes + buffer.length > this.maxBytes) {
        const dropped = this.chunks.shift();
        if (dropped) this.totalBytes -= dropped.length;
      }
    }
    this.chunks.push(buffer);
    this.totalBytes += buffer.length;
  }

  getAudioBase64(): string {
    if (this.chunks.length === 0) return "";
    const combined = Buffer.concat(this.chunks);
    return combined.toString("base64");
  }

  getDurationMs(): number {
    // PCM 16-bit mono at 16kHz = 32000 bytes per second
    return Math.round((this.totalBytes / 32000) * 1000);
  }

  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  isEmpty(): boolean {
    return this.chunks.length === 0;
  }
}
