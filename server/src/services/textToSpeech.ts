/**
 * Text-to-Speech using Google Cloud TTS API
 * Converts translated text to natural-sounding speech
 */

import { TextToSpeechClient, protos } from "@google-cloud/text-to-speech";

const client = new TextToSpeechClient();

// Language to voice mapping
// Using Neural2 or Wavenet voices for natural sound
const VOICE_MAP: Record<string, { languageCode: string; name: string }> = {
  // English
  en: { languageCode: "en-US", name: "en-US-Neural2-J" },
  // Burmese - use standard voice (no neural available)
  my: { languageCode: "my-MM", name: "my-MM-Standard-A" },
  // Thai
  th: { languageCode: "th-TH", name: "th-TH-Neural2-C" },
  // Chinese (Mandarin)
  zh: { languageCode: "cmn-CN", name: "cmn-CN-Wavenet-D" },
  // Japanese
  ja: { languageCode: "ja-JP", name: "ja-JP-Neural2-D" },
  // Korean
  ko: { languageCode: "ko-KR", name: "ko-KR-Neural2-C" },
  // Vietnamese
  vi: { languageCode: "vi-VN", name: "vi-VN-Neural2-D" },
  // Lao - use standard voice
  lo: { languageCode: "lo-LA", name: "lo-LA-Standard-A" },
  // Khmer - use standard voice
  km: { languageCode: "km-KH", name: "km-KH-Standard-A" },
};

// Voice selection by role and gender
type Gender = "male" | "female";
type Role = "doctor" | "patient";

function getVoiceForRole(lang: string, role: Role, gender: Gender): { languageCode: string; name: string } {
  const base = VOICE_MAP[lang] || VOICE_MAP.en;

  // For languages with multiple voice options, select based on gender
  // Neural2 voices: A/C are typically female, B/D are typically male
  if (lang === "en") {
    return {
      languageCode: "en-US",
      name: gender === "female" ? "en-US-Neural2-C" : "en-US-Neural2-J",
    };
  }

  if (lang === "th") {
    return {
      languageCode: "th-TH",
      name: gender === "female" ? "th-TH-Neural2-C" : "th-TH-Standard-A",
    };
  }

  if (lang === "zh") {
    return {
      languageCode: "cmn-CN",
      name: gender === "female" ? "cmn-CN-Wavenet-A" : "cmn-CN-Wavenet-D",
    };
  }

  if (lang === "ja") {
    return {
      languageCode: "ja-JP",
      name: gender === "female" ? "ja-JP-Neural2-B" : "ja-JP-Neural2-D",
    };
  }

  if (lang === "ko") {
    return {
      languageCode: "ko-KR",
      name: gender === "female" ? "ko-KR-Neural2-A" : "ko-KR-Neural2-C",
    };
  }

  if (lang === "vi") {
    return {
      languageCode: "vi-VN",
      name: gender === "female" ? "vi-VN-Neural2-A" : "vi-VN-Neural2-D",
    };
  }

  return base;
}

export interface TTSOptions {
  lang: string;
  role?: Role;
  gender?: Gender;
  speakingRate?: number; // 0.25 to 4.0, default 1.0
}

export interface TTSResult {
  audioBase64: string;
  mimeType: string;
}

/**
 * Convert text to speech
 * Returns base64-encoded audio
 */
export async function textToSpeech(text: string, options: TTSOptions): Promise<TTSResult> {
  if (!text || !text.trim()) {
    return { audioBase64: "", mimeType: "audio/mp3" };
  }

  const { lang, role = "doctor", gender = "male", speakingRate = 1.0 } = options;
  const voice = getVoiceForRole(lang, role, gender);

  const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: { text },
    voice: {
      languageCode: voice.languageCode,
      name: voice.name,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: Math.max(0.25, Math.min(4.0, speakingRate)),
      pitch: 0, // Default pitch
    },
  };

  console.log(`[TTS] Synthesizing "${text.slice(0, 50)}..." in ${voice.name}`);
  const startTime = Date.now();

  try {
    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error("No audio content returned from TTS");
    }

    // Convert to base64
    const audioBase64 = typeof response.audioContent === "string"
      ? response.audioContent
      : Buffer.from(response.audioContent).toString("base64");

    console.log(`[TTS] Completed in ${Date.now() - startTime}ms, ${Math.round(audioBase64.length / 1024)}KB`);

    return {
      audioBase64,
      mimeType: "audio/mp3",
    };
  } catch (err) {
    console.error("[TTS] Error:", err);
    throw err;
  }
}

/**
 * Stream TTS for longer texts (chunked synthesis)
 * Yields audio chunks as they're generated
 */
export async function* textToSpeechStream(
  text: string,
  options: TTSOptions
): AsyncGenerator<TTSResult> {
  // Split text into sentences for more natural streaming
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      yield await textToSpeech(trimmed, options);
    }
  }
}

/**
 * Check if TTS is available for a language
 */
export function isTTSAvailable(lang: string): boolean {
  return lang in VOICE_MAP;
}

/**
 * Get list of supported languages
 */
export function getSupportedTTSLanguages(): string[] {
  return Object.keys(VOICE_MAP);
}
