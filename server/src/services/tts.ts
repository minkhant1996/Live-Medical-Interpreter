import textToSpeech from "@google-cloud/text-to-speech";

const client = new textToSpeech.TextToSpeechClient();

const LANG_VOICE_MAP: Record<string, { languageCode: string; name: string }> = {
  en: { languageCode: "en-US", name: "en-US-Neural2-D" },
  th: { languageCode: "th-TH", name: "th-TH-Neural2-C" },
  my: { languageCode: "my-MM", name: "my-MM-Standard-A" },
  km: { languageCode: "km-KH", name: "km-KH-Standard-A" },
  vi: { languageCode: "vi-VN", name: "vi-VN-Neural2-A" },
  zh: { languageCode: "cmn-CN", name: "cmn-CN-Neural2-D" },
  // Lao has limited Cloud TTS support — handled by Gemini fallback
};

export async function synthesizeSpeech(
  text: string,
  lang: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const voiceConfig = LANG_VOICE_MAP[lang];

  if (!voiceConfig) {
    // Fall back to Gemini TTS for unsupported languages (e.g. Lao)
    return synthesizeSpeechWithGemini(text, lang);
  }

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: voiceConfig.languageCode,
      name: voiceConfig.name,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.9,
    },
  });

  const audioContent = response.audioContent;
  if (!audioContent) {
    throw new Error("No audio content received from TTS");
  }

  const base64 = Buffer.isBuffer(audioContent)
    ? audioContent.toString("base64")
    : Buffer.from(audioContent as Uint8Array).toString("base64");

  return { audioBase64: base64, mimeType: "audio/mpeg" };
}

// Fallback using Gemini TTS when Cloud TTS doesn't support a language well
export async function synthesizeSpeechWithGemini(
  text: string,
  lang: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const { genai, getLangName, sanitizeForPrompt } = await import("./gemini");

  const safeText = sanitizeForPrompt(text, 5000);
  const langName = getLangName(lang);

  const response = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Please read the following text aloud in ${langName}:\n\n<TEXT_TO_READ>${safeText}</TEXT_TO_READ>`,
    config: {
      responseModalities: ["AUDIO"],
    },
  });

  // Extract audio from response
  const part = response.candidates?.[0]?.content?.parts?.[0];
  if (part && "inlineData" in part && part.inlineData) {
    return {
      audioBase64: part.inlineData.data || "",
      mimeType: part.inlineData.mimeType || "audio/mpeg",
    };
  }

  throw new Error("No audio generated from Gemini");
}
