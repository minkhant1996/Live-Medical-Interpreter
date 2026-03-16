/**
 * Voice Activity Detection (VAD) for real-time audio streaming
 * Detects speech segments based on audio energy and triggers events on speech start/end
 */

import { EventEmitter } from "events";

export interface VADConfig {
  // Minimum silence duration (ms) to consider speech ended
  silenceThresholdMs: number;
  // Minimum speech duration (ms) to consider it a valid segment
  minSpeechDurationMs: number;
  // Audio energy threshold (0-1) to detect speech vs silence
  // Lower = more sensitive, higher = less sensitive
  energyThreshold: number;
  // Sample rate of incoming audio
  sampleRate: number;
}

const DEFAULT_CONFIG: VADConfig = {
  silenceThresholdMs: 700,     // End turn after 700ms of silence
  minSpeechDurationMs: 200,    // Ignore very short sounds (clicks, etc)
  energyThreshold: 0.008,      // Lowered for better sensitivity
  sampleRate: 16000,
};

export class VoiceActivityDetector extends EventEmitter {
  private config: VADConfig;
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private audioBuffer: Buffer[] = [];
  private segmentAudioBuffer: Buffer[] = [];

  constructor(config: Partial<VADConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private chunkCount = 0;
  private lastEnergyLog = 0;

  /**
   * Process incoming audio chunk (base64 PCM 16-bit)
   * Emits: 'speech_start', 'speech_end', 'audio' (for each chunk during speech)
   */
  processAudio(base64Pcm: string): void {
    const buffer = Buffer.from(base64Pcm, "base64");
    const energy = this.calculateEnergy(buffer);
    const isSpeech = energy > this.config.energyThreshold;
    const now = Date.now();

    this.chunkCount++;
    // Log energy periodically for debugging (every 50 chunks ~= 1.5 seconds)
    if (this.chunkCount % 50 === 0 || (isSpeech && now - this.lastEnergyLog > 500)) {
      console.log(`[VAD] chunk=${this.chunkCount} energy=${energy.toFixed(4)} threshold=${this.config.energyThreshold} speech=${isSpeech}`);
      this.lastEnergyLog = now;
    }

    if (isSpeech) {
      // Clear any pending silence timer
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      if (!this.isSpeaking) {
        // Speech just started
        this.isSpeaking = true;
        this.speechStartTime = now;
        this.segmentAudioBuffer = [];
        console.log(`[VAD] Emitting speech_start (energy=${energy.toFixed(4)})`);
        this.emit("speech_start");
      }

      this.lastSpeechTime = now;
      this.segmentAudioBuffer.push(buffer);

      // Emit audio chunk for real-time processing
      this.emit("audio", base64Pcm);
    } else {
      // Silence detected
      if (this.isSpeaking) {
        // Still include this chunk in the buffer (might have trailing speech)
        this.segmentAudioBuffer.push(buffer);
        this.emit("audio", base64Pcm);

        // Start silence timer if not already running
        if (!this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.endSpeechSegment();
          }, this.config.silenceThresholdMs);
        }
      }
    }
  }

  /**
   * Force end of current speech segment (e.g., when user clicks stop)
   */
  forceEnd(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.isSpeaking) {
      this.endSpeechSegment();
    }
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.audioBuffer = [];
    this.segmentAudioBuffer = [];
  }

  private endSpeechSegment(): void {
    const speechDuration = this.lastSpeechTime - this.speechStartTime;

    if (speechDuration >= this.config.minSpeechDurationMs) {
      // Valid speech segment
      const segmentAudio = Buffer.concat(this.segmentAudioBuffer);
      this.emit("speech_end", {
        durationMs: speechDuration,
        audioBuffer: segmentAudio,
        audioBase64: segmentAudio.toString("base64"),
      });
    } else {
      // Too short - likely noise, ignore
      this.emit("speech_too_short", { durationMs: speechDuration });
    }

    this.isSpeaking = false;
    this.silenceTimer = null;
    this.segmentAudioBuffer = [];
  }

  /**
   * Calculate RMS energy of audio buffer (PCM 16-bit little-endian)
   */
  private calculateEnergy(buffer: Buffer): number {
    if (buffer.length < 2) return 0;

    let sumSquares = 0;
    const numSamples = Math.floor(buffer.length / 2);

    for (let i = 0; i < buffer.length - 1; i += 2) {
      // Read 16-bit signed little-endian sample
      const sample = buffer.readInt16LE(i);
      // Normalize to -1 to 1 range
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }

    // Return RMS (root mean square) energy
    return Math.sqrt(sumSquares / numSamples);
  }

  isCurrentlySpeaking(): boolean {
    return this.isSpeaking;
  }
}
