import { useRef, useState, useCallback, useEffect } from "react";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return new ArrayBuffer(0);
  }
}

// Convert Float32Array to 16-bit PCM
function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Resample audio from source rate to target rate
function resample(audioData: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return audioData;

  const ratio = sourceRate / targetRate;
  const newLength = Math.floor(audioData.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
    const t = srcIndex - srcIndexFloor;
    result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
  }

  return result;
}

// Calculate RMS (root mean square) energy of audio samples
function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

const ALLOWED_AUDIO_MIMES = ["audio/mpeg", "audio/pcm", "audio/pcm;rate=24000", "audio/pcm;rate=16000", "audio/L16;rate=24000"];
const MAX_AUDIO_LENGTH = 20_000_000;

// VAD settings - optimized for natural speech grouping
const SPEECH_THRESHOLD = 0.008;      // RMS threshold for speech detection (more sensitive)
const SILENCE_DURATION_MS = 800;     // 800ms silence to end turn (allows natural pauses)
const MIN_SPEECH_DURATION_MS = 200;  // Minimum 200ms speech
const TARGET_SAMPLE_RATE = 16000;    // Output sample rate for Gemini

interface UseAudioStreamerOptions {
  onSpeechStart?: () => void;
  onAudioChunk?: (audioBase64: string) => void;  // Stream audio while speaking
  onSpeechEnd?: () => void;  // Signal turn complete (no audio - already streamed)
}

export function useAudioStreamer({ onSpeechStart, onAudioChunk, onSpeechEnd }: UseAudioStreamerOptions) {
  const [isStreaming, setIsStreaming] = useState(false);

  // Audio capture refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sampleRateRef = useRef<number>(48000);

  // VAD state refs
  const isSpeakingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const speechStartTimeRef = useRef<number | null>(null);
  const rmsHistoryRef = useRef<number[]>([]);

  // Playback refs
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeAudiosRef = useRef<Set<HTMLAudioElement>>(new Set());

  // Store callbacks in refs
  const onSpeechStartRef = useRef(onSpeechStart);
  const onAudioChunkRef = useRef(onAudioChunk);
  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechStartRef.current = onSpeechStart;
  onAudioChunkRef.current = onAudioChunk;
  onSpeechEndRef.current = onSpeechEnd;

  // Unlock audio on first user interaction (required for mobile browsers)
  useEffect(() => {
    const unlockAudio = async () => {
      if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
        playbackCtxRef.current = new AudioContext();
      }
      if (playbackCtxRef.current.state === "suspended") {
        try {
          await playbackCtxRef.current.resume();
          console.log("[Audio] AudioContext unlocked on user interaction");
        } catch (err) {
          console.warn("[Audio] Failed to unlock AudioContext:", err);
        }
      }
      document.removeEventListener("touchstart", unlockAudio);
      document.removeEventListener("touchend", unlockAudio);
      document.removeEventListener("click", unlockAudio);
    };

    document.addEventListener("touchstart", unlockAudio, { once: true });
    document.addEventListener("touchend", unlockAudio, { once: true });
    document.addEventListener("click", unlockAudio, { once: true });

    return () => {
      document.removeEventListener("touchstart", unlockAudio);
      document.removeEventListener("touchend", unlockAudio);
      document.removeEventListener("click", unlockAudio);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackCtxRef.current) {
        playbackCtxRef.current.close().catch(() => {});
        playbackCtxRef.current = null;
      }
      activeAudiosRef.current.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      activeAudiosRef.current.clear();
    };
  }, []);

  const startStreaming = useCallback(async () => {
    try {
      console.log("[VAD] Starting real-time streaming...");

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const sampleRate = audioContext.sampleRate;
      sampleRateRef.current = sampleRate;

      // Create source and processor
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1); // Smaller buffer for lower latency
      processorRef.current = processor;

      // Reset VAD state
      isSpeakingRef.current = false;
      silenceStartRef.current = null;
      speechStartTimeRef.current = null;
      rmsHistoryRef.current = [];

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const samples = new Float32Array(inputData);
        const rms = calculateRMS(samples);
        const now = Date.now();

        // Smooth RMS with rolling average (last 3 frames)
        rmsHistoryRef.current.push(rms);
        if (rmsHistoryRef.current.length > 3) {
          rmsHistoryRef.current.shift();
        }
        const smoothedRms = rmsHistoryRef.current.reduce((a, b) => a + b, 0) / rmsHistoryRef.current.length;

        if (smoothedRms > SPEECH_THRESHOLD) {
          // Sound detected - stream audio immediately
          if (!isSpeakingRef.current) {
            // Speech just started
            isSpeakingRef.current = true;
            speechStartTimeRef.current = now;
            console.log("[VAD] Speech started (RMS:", smoothedRms.toFixed(4), ")");
            onSpeechStartRef.current?.();
          }
          silenceStartRef.current = null;

          // Stream this chunk immediately (resample and convert)
          const resampled = resample(samples, sampleRate, TARGET_SAMPLE_RATE);
          const pcm16 = float32ToPcm16(resampled);
          const base64 = arrayBufferToBase64(pcm16);
          onAudioChunkRef.current?.(base64);

        } else if (isSpeakingRef.current) {
          // Silence while speaking - still send audio (might be brief pause)
          const resampled = resample(samples, sampleRate, TARGET_SAMPLE_RATE);
          const pcm16 = float32ToPcm16(resampled);
          const base64 = arrayBufferToBase64(pcm16);
          onAudioChunkRef.current?.(base64);

          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= SILENCE_DURATION_MS) {
            // Silence duration exceeded - turn complete
            const speechDuration = now - (speechStartTimeRef.current || now);

            if (speechDuration >= MIN_SPEECH_DURATION_MS) {
              console.log("[VAD] Speech ended, duration:", speechDuration, "ms");
              onSpeechEndRef.current?.();  // Just signal end, audio already streamed
            } else {
              console.log("[VAD] Speech too short, ignoring:", speechDuration, "ms");
            }

            // Reset state
            isSpeakingRef.current = false;
            silenceStartRef.current = null;
            speechStartTimeRef.current = null;
          }
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsStreaming(true);
      console.log("[VAD] Started streaming at", sampleRate, "Hz");

    } catch (err) {
      console.error("[VAD] Failed to start:", err);
      throw err;
    }
  }, []);

  const stopStreaming = useCallback(() => {
    console.log("[VAD] Stopping streaming...");

    // Stop processor first (to prevent more callbacks)
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch (e) {
        console.log("[VAD] Processor disconnect error (ok):", e);
      }
      processorRef.current = null;
    }

    // Stop media stream tracks immediately (stops microphone)
    if (mediaStreamRef.current) {
      const tracks = mediaStreamRef.current.getTracks();
      console.log("[VAD] Stopping", tracks.length, "media tracks");
      tracks.forEach(track => {
        track.stop();
        track.enabled = false;
      });
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      const state = audioContextRef.current.state;
      console.log("[VAD] Closing audio context, state:", state);
      if (state !== "closed") {
        audioContextRef.current.close().catch((e) => {
          console.log("[VAD] AudioContext close error (ok):", e);
        });
      }
      audioContextRef.current = null;
    }

    // Reset VAD state
    isSpeakingRef.current = false;
    silenceStartRef.current = null;
    speechStartTimeRef.current = null;
    rmsHistoryRef.current = [];

    setIsStreaming(false);
    console.log("[VAD] Stopped");
  }, []);

  const playAudioResponse = useCallback(
    (base64Audio: string, mimeType: string) => {
      if (base64Audio.length > MAX_AUDIO_LENGTH) return;
      const safeMime = ALLOWED_AUDIO_MIMES.some(m => mimeType.startsWith(m.split(";")[0]))
        ? mimeType
        : "audio/mpeg";

      const audio = new Audio(`data:${safeMime};base64,${base64Audio}`);
      activeAudiosRef.current.add(audio);
      audio.onended = () => activeAudiosRef.current.delete(audio);
      audio.onerror = () => activeAudiosRef.current.delete(audio);
      audio.play().catch(console.error);
    },
    []
  );

  const playPcmAudio = useCallback(
    async (base64Pcm: string, mimeType: string) => {
      console.log("[Audio] playPcmAudio called, size:", base64Pcm?.length, "mime:", mimeType);

      if (!base64Pcm || base64Pcm.length === 0) {
        console.warn("[Audio] Empty audio data, skipping");
        return;
      }

      if (base64Pcm.length > MAX_AUDIO_LENGTH) {
        console.warn("[Audio] Audio too long, skipping");
        return;
      }

      if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
        console.log("[Audio] Creating new AudioContext");
        playbackCtxRef.current = new AudioContext();
      }
      const ctx = playbackCtxRef.current;
      console.log("[Audio] AudioContext state:", ctx.state);

      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
          console.log("[Audio] AudioContext resumed for playback");
        } catch (err) {
          console.error("[Audio] Failed to resume AudioContext:", err);
          return;
        }
      }

      let sampleRate = 24000;
      const rateMatch = mimeType.match(/rate=(\d+)/);
      if (rateMatch) {
        sampleRate = parseInt(rateMatch[1], 10);
      }

      const arrayBuffer = base64ToArrayBuffer(base64Pcm);
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      if (float32.length === 0) return;

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      playbackQueueRef.current.push(audioBuffer);
      if (!isPlayingRef.current) {
        playNextInQueue(ctx);
      }
    },
    []
  );

  function playNextInQueue(ctx: AudioContext) {
    const buffer = playbackQueueRef.current.shift();
    if (!buffer) {
      isPlayingRef.current = false;
      currentSourceRef.current = null;
      return;
    }

    isPlayingRef.current = true;
    const source = ctx.createBufferSource();
    currentSourceRef.current = source;
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      currentSourceRef.current = null;
      playNextInQueue(ctx);
    };
    source.start();
  }

  const clearPlaybackQueue = useCallback(() => {
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    activeAudiosRef.current.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    activeAudiosRef.current.clear();
  }, []);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    playAudioResponse,
    playPcmAudio,
    clearPlaybackQueue,
  };
}
