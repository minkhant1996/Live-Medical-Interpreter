import {
  GoogleGenAI,
  type LiveServerMessage,
  type Session,
  type ProactivityConfig,
  Modality,
  MediaResolution,
} from "@google/genai";
import { EventEmitter } from "events";
import { getLangName } from "./gemini";
import { classifyGeminiError } from "../middleware/errorHandler";

const USE_VERTEX = process.env.USE_VERTEX_AI === "true";

const ai = USE_VERTEX
  ? new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GCP_REGION || "us-central1",
  })
  : new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || "" });

const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";

// Session idle timeout: close if no audio sent for 5 minutes
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// Max session duration: 15 minutes
const MAX_SESSION_MS = 15 * 60 * 1000;
// Max retries for transient connection failures
const MAX_CONNECT_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
// Max text buffer size to prevent unbounded growth
const MAX_TEXT_BUFFER = 50_000;

// Voice selection based on role and gender
// Doctor: authoritative/professional voice
// Patient: warm/friendly voice
type Gender = "male" | "female";

function getVoiceForRole(role: "doctor" | "patient", gender: Gender): string {
  if (role === "doctor") {
    // Doctor: authoritative, professional
    // Male: Charon (informative, authoritative)
    // Female: Kore (firm, confident)
    return gender === "female" ? "Kore" : "Charon";
  } else {
    // Patient: warm, friendly, polite
    // Male: Puck (upbeat, lively - more approachable)
    // Female: Aoede (bright, positive)
    return gender === "female" ? "Aoede" : "Puck";
  }
}

// Pre-made examples for each language pair (doctor side)
interface LanguageExamples {
  positive: { source: string; target: string }[];
  negative: { context: string; wrong: string; correct: string }[];
  unclearWrong: string;
}

// Pre-made examples for each language pair (patient side)
const PATIENT_EXAMPLES: Record<string, LanguageExamples> = {
  // Myanmar → English
  "my-en": {
    positive: [
      { source: "မင်္ဂလာပါဆရာ၊ သုံးရက်လောက်ကတည်းက ဖျားတယ်၊ ချောင်းဆိုးတယ်၊ လည်ချောင်းနာတယ်။", target: "Hello doctor, I have had a fever, cough, and sore throat for about three days." },
      { source: "အသက်ရှူရတာ နည်းနည်းခက်တယ်။", target: "I have a little difficulty breathing." },
      { source: "ဒီနေရာမှာ နာတယ်။", target: "It hurts here." },
    ],
    negative: [
      { context: 'Patient: "နေမကောင်းဘူး။"', wrong: "I'm sorry to hear that.", correct: "I don't feel well." },
      { context: 'Patient: "ဖျားတယ်။"', wrong: "Do you have a fever?", correct: "I have a fever." },
    ],
    unclearWrong: "I'm sorry, I didn't catch that.",
  },
  // Myanmar → Thai
  "my-th": {
    positive: [
      { source: "မင်္ဂလာပါဆရာ၊ သုံးရက်လောက်ကတည်းက ဖျားတယ်၊ ချောင်းဆိုးတယ်၊ လည်ချောင်းနာတယ်။", target: "สวัสดีครับ/ค่ะคุณหมอ มีไข้ ไอ และเจ็บคอมาประมาณสามวันแล้วครับ/ค่ะ" },
      { source: "အသက်ရှူရတာ နည်းနည်းခက်တယ်။", target: "หายใจลำบากนิดหน่อยครับ/ค่ะ" },
      { source: "ဒီနေရာမှာ နာတယ်။", target: "เจ็บตรงนี้ครับ/ค่ะ" },
    ],
    negative: [
      { context: 'Patient: "နေမကောင်းဘူး။"', wrong: "เสียใจด้วยนะครับ/คะ", correct: "ไม่สบายครับ/ค่ะ" },
      { context: 'Patient: "ဖျားတယ်။"', wrong: "คุณมีไข้ไหมครับ/คะ", correct: "มีไข้ครับ/ค่ะ" },
    ],
    unclearWrong: "ขอโทษครับ/ค่ะ ไม่ได้ยิน",
  },
  // Thai → English
  "th-en": {
    positive: [
      { source: "สวัสดีครับ/ค่ะคุณหมอ มีไข้ ไอ และเจ็บคอมาประมาณสามวันแล้ว", target: "Hello doctor, I have had a fever, cough, and sore throat for about three days." },
      { source: "หายใจลำบากนิดหน่อย", target: "I have a little difficulty breathing." },
      { source: "เจ็บตรงนี้", target: "It hurts here." },
    ],
    negative: [
      { context: 'Patient: "ไม่สบาย"', wrong: "I'm sorry to hear that.", correct: "I don't feel well." },
      { context: 'Patient: "มีไข้"', wrong: "Do you have a fever?", correct: "I have a fever." },
    ],
    unclearWrong: "I'm sorry, I didn't catch that.",
  },
  // Thai → Myanmar
  "th-my": {
    positive: [
      { source: "สวัสดีครับ/ค่ะคุณหมอ มีไข้ ไอ และเจ็บคอมาประมาณสามวันแล้ว", target: "မင်္ဂလာပါဆရာ၊ သုံးရက်လောက်ကတည်းက ဖျားတယ်၊ ချောင်းဆိုးတယ်၊ လည်ချောင်းနာတယ်။" },
      { source: "หายใจลำบากนิดหน่อย", target: "အသက်ရှူရတာ နည်းနည်းခက်တယ်။" },
      { source: "เจ็บตรงนี้", target: "ဒီနေရာမှာ နာတယ်။" },
    ],
    negative: [
      { context: 'Patient: "ไม่สบาย"', wrong: "ဝမ်းနည်းပါတယ်။", correct: "နေမကောင်းဘူး။" },
      { context: 'Patient: "มีไข้"', wrong: "ဖျားနေလား။", correct: "ဖျားတယ်။" },
    ],
    unclearWrong: "မကြားရပါဘူး။",
  },
  // English → Myanmar
  "en-my": {
    positive: [
      { source: "Hello doctor, I have had a fever, cough, and sore throat for about three days.", target: "မင်္ဂလာပါဆရာ၊ သုံးရက်လောက်ကတည်းက ဖျားတယ်၊ ချောင်းဆိုးတယ်၊ လည်ချောင်းနာတယ်။" },
      { source: "I have a little difficulty breathing.", target: "အသက်ရှူရတာ နည်းနည်းခက်တယ်။" },
      { source: "It hurts here.", target: "ဒီနေရာမှာ နာတယ်။" },
    ],
    negative: [
      { context: 'Patient: "I don\'t feel well."', wrong: "ဝမ်းနည်းပါတယ်။", correct: "နေမကောင်းဘူး။" },
      { context: 'Patient: "I have a fever."', wrong: "ဖျားနေလား။", correct: "ဖျားတယ်။" },
    ],
    unclearWrong: "မကြားရပါဘူး။",
  },
  // English → Thai
  "en-th": {
    positive: [
      { source: "Hello doctor, I have had a fever, cough, and sore throat for about three days.", target: "สวัสดีครับ/ค่ะคุณหมอ มีไข้ ไอ และเจ็บคอมาประมาณสามวันแล้วครับ/ค่ะ" },
      { source: "I have a little difficulty breathing.", target: "หายใจลำบากนิดหน่อยครับ/ค่ะ" },
      { source: "It hurts here.", target: "เจ็บตรงนี้ครับ/ค่ะ" },
    ],
    negative: [
      { context: 'Patient: "I don\'t feel well."', wrong: "เสียใจด้วยนะครับ/คะ", correct: "ไม่สบายครับ/ค่ะ" },
      { context: 'Patient: "I have a fever."', wrong: "คุณมีไข้ไหมครับ/คะ", correct: "มีไข้ครับ/ค่ะ" },
    ],
    unclearWrong: "ขอโทษครับ/ค่ะ ไม่ได้ยิน",
  },
};

const DOCTOR_EXAMPLES: Record<string, LanguageExamples> = {
  // English → Myanmar
  "en-my": {
    positive: [
      { source: "How are you feeling today?", target: "ဒီနေ့ ဘယ်လိုခံစားရလဲ။" },
      { source: "Please take a deep breath.", target: "အသက်ကို နက်နက်ရှိုင်းရှိုင်း ရှူပါ။" },
      { source: "Can you point to where it hurts?", target: "ဘယ်နေရာမှာ နာလဲဆိုတာ လက်ညှိုးထိုးပြပါ။" },
    ],
    negative: [
      { context: 'Doctor: "How are you feeling?"', wrong: "ကျွန်တော် နေလို့ကောင်းပါတယ်။", correct: "ဘယ်လိုခံစားရလဲ။" },
      { context: 'Doctor: "Do you have a fever?"', wrong: "သင့်မှာ fever ရှိပါသလား။ Please answer yes or no.", correct: "ဖျားနာနေလား။" },
    ],
    unclearWrong: "မကြားရပါဘူး။ ထပ်ပြောပါ။",
  },
  // English → Thai
  "en-th": {
    positive: [
      { source: "How are you feeling today?", target: "วันนี้รู้สึกอย่างไรบ้างครับ/คะ" },
      { source: "Please take a deep breath.", target: "กรุณาหายใจเข้าลึกๆ ครับ/คะ" },
      { source: "Can you point to where it hurts?", target: "ช่วยชี้ตรงที่เจ็บให้หน่อยได้ไหมครับ/คะ" },
    ],
    negative: [
      { context: 'Doctor: "How are you feeling?"', wrong: "ผม/ฉันสบายดีครับ/ค่ะ", correct: "รู้สึกอย่างไรบ้างครับ/คะ" },
      { context: 'Doctor: "Do you have a fever?"', wrong: "คุณมีไข้ไหมครับ/คะ กรุณาตอบใช่หรือไม่", correct: "มีไข้ไหมครับ/คะ" },
    ],
    unclearWrong: "ไม่ได้ยินครับ/ค่ะ กรุณาพูดอีกครั้ง",
  },
  // Thai → English
  "th-en": {
    positive: [
      { source: "วันนี้รู้สึกอย่างไรบ้าง", target: "How are you feeling today?" },
      { source: "กรุณาหายใจเข้าลึกๆ", target: "Please take a deep breath." },
      { source: "ช่วยชี้ตรงที่เจ็บให้หน่อย", target: "Can you point to where it hurts?" },
    ],
    negative: [
      { context: 'Doctor: "รู้สึกอย่างไรบ้าง"', wrong: "I am feeling fine.", correct: "How are you feeling?" },
      { context: 'Doctor: "มีไข้ไหม"', wrong: "Do you have a fever? Please answer yes or no.", correct: "Do you have a fever?" },
    ],
    unclearWrong: "I didn't hear. Please repeat.",
  },
  // Thai → Myanmar
  "th-my": {
    positive: [
      { source: "วันนี้รู้สึกอย่างไรบ้าง", target: "ဒီနေ့ ဘယ်လိုခံစားရလဲ။" },
      { source: "กรุณาหายใจเข้าลึกๆ", target: "အသက်ကို နက်နက်ရှိုင်းရှိုင်း ရှူပါ။" },
      { source: "ช่วยชี้ตรงที่เจ็บให้หน่อย", target: "ဘယ်နေရာမှာ နာလဲဆိုတာ လက်ညှိုးထိုးပြပါ။" },
    ],
    negative: [
      { context: 'Doctor: "รู้สึกอย่างไรบ้าง"', wrong: "ကျွန်တော် နေလို့ကောင်းပါတယ်။", correct: "ဘယ်လိုခံစားရလဲ။" },
      { context: 'Doctor: "มีไข้ไหม"', wrong: "ဖျားနေလား။ ဟုတ် သို့မဟုတ် မဟုတ် ဖြေပါ။", correct: "ဖျားနာနေလား။" },
    ],
    unclearWrong: "မကြားရပါဘူး။ ထပ်ပြောပါ။",
  },
  // Myanmar → English
  "my-en": {
    positive: [
      { source: "ဒီနေ့ ဘယ်လိုခံစားရလဲ။", target: "How are you feeling today?" },
      { source: "အသက်ကို နက်နက်ရှိုင်းရှိုင်း ရှူပါ။", target: "Please take a deep breath." },
      { source: "ဘယ်နေရာမှာ နာလဲဆိုတာ လက်ညှိုးထိုးပြပါ။", target: "Can you point to where it hurts?" },
    ],
    negative: [
      { context: 'Doctor: "ဘယ်လိုခံစားရလဲ"', wrong: "I am feeling fine.", correct: "How are you feeling?" },
      { context: 'Doctor: "ဖျားနာနေလား"', wrong: "Do you have a fever? Please answer yes or no.", correct: "Do you have a fever?" },
    ],
    unclearWrong: "I didn't hear. Please repeat.",
  },
  // Myanmar → Thai
  "my-th": {
    positive: [
      { source: "ဒီနေ့ ဘယ်လိုခံစားရလဲ။", target: "วันนี้รู้สึกอย่างไรบ้างครับ/คะ" },
      { source: "အသက်ကို နက်နက်ရှိုင်းရှိုင်း ရှူပါ။", target: "กรุณาหายใจเข้าลึกๆ ครับ/คะ" },
      { source: "ဘယ်နေရာမှာ နာလဲဆိုတာ လက်ညှိုးထိုးပြပါ။", target: "ช่วยชี้ตรงที่เจ็บให้หน่อยได้ไหมครับ/คะ" },
    ],
    negative: [
      { context: 'Doctor: "ဘယ်လိုခံစားရလဲ"', wrong: "ผม/ฉันสบายดีครับ/ค่ะ", correct: "รู้สึกอย่างไรบ้างครับ/คะ" },
      { context: 'Doctor: "ဖျားနာနေလား"', wrong: "มีไข้ไหมครับ/คะ กรุณาตอบใช่หรือไม่", correct: "มีไข้ไหมครับ/คะ" },
    ],
    unclearWrong: "ไม่ได้ยินครับ/ค่ะ กรุณาพูดอีกครั้ง",
  },
};

function getDoctorExamples(fromLang: string, toLang: string): string {
  const key = `${fromLang}-${toLang}`;
  const examples = DOCTOR_EXAMPLES[key];
  const fromLangName = getLangName(fromLang);
  const toLangName = getLangName(toLang);
  const otherLangs = getOtherLanguages(fromLangName, toLangName);

  if (!examples) {
    return `EXAMPLES:
${fromLangName}: "How are you?" → ${toLangName}: (translate)
${fromLangName}: [unclear] → ""
${otherLangs[0]} speech heard → "" (wrong language, ignore)
${otherLangs[1] || otherLangs[0]} speech heard → "" (wrong language, ignore)

NEVER DO:
- Hear ${otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""
- Hear patient speaking → Wrong: Respond to patient. Correct: Output ""
- Hear ${toLangName} speech → Wrong: Translate ${toLangName} to ${toLangName}. Correct: Output ""`;
  }

  let examplesText = "EXAMPLES:\n";
  for (const ex of examples.positive) {
    examplesText += `${fromLangName}: "${ex.source}" → ${toLangName}: "${ex.target}"\n`;
  }
  examplesText += `${fromLangName}: [unclear] → ""\n`;
  examplesText += `${otherLangs[0]} speech heard → "" (wrong language)\n`;
  examplesText += `${otherLangs[1] || otherLangs[0]} speech heard → "" (wrong language)\n`;

  // Add negative examples to prevent translating wrong language
  examplesText += "\nNEVER DO:\n";
  examplesText += `- Hear ${otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""\n`;
  examplesText += `- Hear ${otherLangs[1] || otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""\n`;
  examplesText += `- Hear patient speaking ${toLangName} → Wrong: Respond. Correct: Output ""\n`;

  // Add original negative examples if they exist
  if (examples.negative) {
    for (const neg of examples.negative) {
      examplesText += `- ${neg.context} → Wrong: "${neg.wrong}". Correct: "${neg.correct}"\n`;
    }
  }

  return examplesText;
}

function getPatientExamples(fromLang: string, toLang: string): string {
  const key = `${fromLang}-${toLang}`;
  const examples = PATIENT_EXAMPLES[key];
  const fromLangName = getLangName(fromLang);
  const toLangName = getLangName(toLang);
  const otherLangs = getOtherLanguages(fromLangName, toLangName);

  if (!examples) {
    return `EXAMPLES:
${fromLangName}: "I have pain" → ${toLangName}: (translate as first person)
${fromLangName}: [unclear] → ""
${otherLangs[0]} speech heard → "" (wrong language, ignore)
${otherLangs[1] || otherLangs[0]} speech heard → "" (wrong language, ignore)

NEVER DO:
- Patient: "I feel sick" → Wrong: "I'm sorry to hear that" (responding)
- Patient: "I feel sick" → Correct: Translate "I feel sick" to ${toLangName}
- Hear ${otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""
- Hear doctor speaking → Wrong: Respond to doctor. Correct: Output ""`;
  }

  let examplesText = "EXAMPLES:\n";
  for (const ex of examples.positive) {
    examplesText += `${fromLangName}: "${ex.source}" → ${toLangName}: "${ex.target}"\n`;
  }
  examplesText += `${fromLangName}: [unclear] → ""\n`;
  examplesText += `${otherLangs[0]} speech heard → "" (wrong language)\n`;
  examplesText += `${otherLangs[1] || otherLangs[0]} speech heard → "" (wrong language)\n`;

  // Add negative examples to prevent responding instead of translating
  examplesText += "\nNEVER DO:\n";
  examplesText += `- Hear ${otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""\n`;
  examplesText += `- Hear ${otherLangs[1] || otherLangs[0]} speech → Wrong: Translate it. Correct: Output ""\n`;
  examplesText += `- Hear doctor speaking ${toLangName} → Wrong: Respond. Correct: Output ""\n`;

  // Add original negative examples if they exist
  if (examples.negative) {
    for (const neg of examples.negative) {
      examplesText += `- ${neg.context} → Wrong: "${neg.wrong}" (responding, not translating). Correct: "${neg.correct}"\n`;
    }
  }

  return examplesText;
}

// Get other languages to reject (for strict source language enforcement)
// Exclude both source and target languages - only reject truly other languages
function getOtherLanguages(sourceLang: string, targetLang?: string): string[] {
  const allLangs = ["English", "Thai", "Myanmar", "Vietnamese", "Khmer", "Lao", "Chinese"];
  return allLangs.filter(lang => lang !== sourceLang && lang !== targetLang);
}

function getDoctorInterpreterPrompt(fromLang: string, toLang: string): string {
  const fromLangName = getLangName(fromLang);
  const toLangName = getLangName(toLang);
  const otherLangs = getOtherLanguages(fromLangName, toLangName);

  return `You are a TRANSLATOR, not an assistant. You translate speech word-for-word.

ROLE: Translate ${fromLangName} → ${toLangName} (for a patient to understand)

CRITICAL RULES:
1. ONLY output the translation - nothing else
2. DO NOT respond, answer, or react to what you hear
3. DO NOT add greetings, sympathy, or commentary
4. Preserve the speaker's perspective (first-person stays first-person)

TRANSLATE:
- Everything spoken in ${fromLangName}
- Keep the same tone and meaning
- Questions stay as questions, instructions stay as instructions

OUTPUT SILENCE ("") IF:
- Audio is in ${otherLangs.join(" or ")} (wrong language)
- Audio is unclear or silent

FORBIDDEN RESPONSES (never say these):
- "I understand"
- "Of course"
- "Sure"
- Any acknowledgment or reaction
- Any response to the content

${getDoctorExamples(fromLang, toLang)}`;
}

function getPatientInterpreterPrompt(fromLang: string, toLang: string): string {
  const fromLangName = getLangName(fromLang);
  const toLangName = getLangName(toLang);
  const otherLangs = getOtherLanguages(fromLangName, toLangName);

  return `You are a TRANSLATOR, not an assistant. You translate speech word-for-word.

ROLE: Translate ${fromLangName} → ${toLangName} (for a doctor to understand)

CRITICAL RULES:
1. ONLY output the translation - nothing else
2. DO NOT respond, answer, or react to what you hear
3. DO NOT add greetings, sympathy, or commentary
4. Preserve the speaker's perspective (first-person stays first-person)

TRANSLATE:
- Everything spoken in ${fromLangName}
- Keep the same tone and meaning
- "I have fever" → translate as "I have fever" (NOT "The patient has fever")

OUTPUT SILENCE ("") IF:
- Audio is in ${otherLangs.join(" or ")} (wrong language)
- Audio is unclear or silent

FORBIDDEN RESPONSES (never say these):
- "I'm sorry to hear that"
- "You should see a doctor"
- "How can I help you?"
- "I understand"
- Any question back to the speaker
- Any medical advice

${getPatientExamples(fromLang, toLang)}`;
}

function getInterpreterPrompt(fromLang: string, toLang: string, speakerGender: "male" | "female", role: "doctor" | "patient" = "doctor"): string {
  // Use role-specific prompts for stricter behavior
  if (role === "doctor") {
    return getDoctorInterpreterPrompt(fromLang, toLang);
  } else {
    return getPatientInterpreterPrompt(fromLang, toLang);
  }
}

export class LiveInterpreterSession extends EventEmitter {
  private session: Session | null = null;
  private fromLang: string;
  private toLang: string;
  private role: "doctor" | "patient";
  private gender: Gender;
  private isActive: boolean = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunkCount: number = 0;
  private systemPrompt: string = "";

  constructor(
    role: "doctor" | "patient",
    doctorLang: string,
    patientLang: string = "my",
    gender: Gender = "male"
  ) {
    super();
    this.role = role;
    this.gender = gender;
    this.fromLang = role === "doctor" ? doctorLang : patientLang;
    this.toLang = role === "doctor" ? patientLang : doctorLang;
    // Store the system prompt for analytics tracking
    this.systemPrompt = getInterpreterPrompt(this.fromLang, this.toLang, gender, role);
  }

  async connect(): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_CONNECT_RETRIES; attempt++) {
      try {
        await this.tryConnect();
        this.startSessionTimer();
        // Don't prime - let the system prompt handle it. Priming triggers unwanted speech.
        return;
      } catch (err) {
        lastError = err;
        const classified = classifyGeminiError(err);

        // Don't retry non-retryable errors
        if (!classified.retryable || attempt === MAX_CONNECT_RETRIES) {
          break;
        }

        console.log(
          `Live session connect attempt ${attempt + 1} failed (${classified.code}), retrying in ${RETRY_DELAY_MS}ms...`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    const classified = classifyGeminiError(lastError);
    throw new Error(classified.error);
  }

  private async tryConnect(): Promise<void> {
    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        // AUDIO response only
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,

        // Context window compression for long sessions (prevents context overflow)
        // triggerTokens: when to start compressing, slidingWindow.targetTokens: target after compression
        contextWindowCompression: {
          triggerTokens: "104857",
          slidingWindow: { targetTokens: "52428" },
        },

        // VAD (Voice Activity Detection) configuration
        // Option 1: AUTO VAD - Gemini automatically detects speech start/end
        // realtimeInputConfig: {
        //   automaticActivityDetection: {
        //     disabled: false, // Use automatic VAD
        //   },
        // },
        // Option 2: MANUAL VAD - We control when speech starts/ends via activityStart/activityEnd
        // Gives precise control over turn-taking but requires frontend VAD
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true, // Disable automatic VAD, use manual activityStart/End
          },
        },

        // Proactive Audio - Model responds only when relevant (filters background conversations)
        // Useful for: distinguishing speaker from background, reducing interruptions
        // For interpreter: consider enabling so model only responds to directed speech
        // proactivity: {
        //   proactiveAudio: true,
        // } as ProactivityConfig,

        // Affective Dialog - Enables emotional/expressive responses
        // For interpreter: probably not needed, we want neutral translations
        // enableAffectiveDialog: false,

        // Minimal thinking for translation accuracy
        thinkingConfig: {
          thinkingBudget: 500,
        },

        // Enable transcriptions for both input and output audio
        inputAudioTranscription: {},
        outputAudioTranscription: {},

        // Voice config - use appropriate voice for the TARGET language listener
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: getVoiceForRole(this.role, this.gender),
            },
          },
        },

        // System prompt
        systemInstruction: {
          parts: [
            { text: getInterpreterPrompt(this.fromLang, this.toLang, this.gender, this.role) },
          ],
        },
      },
      callbacks: {
        onopen: () => {
          console.log(
            `Live session opened: ${this.fromLang} → ${this.toLang}`
          );
          this.isActive = true;
          this.resetIdleTimer();
          this.emit("open");
        },
        onmessage: (message: LiveServerMessage) => {
          if (!this.isActive) return; // Ignore messages after close
          this.handleMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          if (!this.isActive) return;
          console.error("Live session error:", e.message);
          const classified = classifyGeminiError(new Error(e.message));
          this.emit("error", classified.error);
        },
        onclose: (e: CloseEvent) => {
          console.log("Live session closed:", e.reason);
          this.isActive = false;
          this.clearTimers();
          this.emit("close");
        },
      },
    });
  }

  private handleMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;

    // Debug: log ALL messages to understand what Gemini returns
    const msgKeys = Object.keys(message);
    console.log(`[Gemini Live] Message keys: ${msgKeys.join(", ")}`);

    if (!serverContent) {
      console.log(`[Gemini Live] No serverContent in message:`, JSON.stringify(message).slice(0, 500));
      return;
    }

    // Debug: log all serverContent keys
    const keys = Object.keys(serverContent);
    console.log(`[Gemini Live] serverContent keys: ${keys.join(", ")}`);

    // Handle audio output from model
    if (serverContent.modelTurn) {
      console.log(`[Gemini Live] modelTurn present, parts: ${serverContent.modelTurn.parts?.length || 0}`);
    }
    if (serverContent.modelTurn?.parts) {
      for (const part of serverContent.modelTurn.parts) {
        console.log(`[Gemini Live] Part keys: ${Object.keys(part).join(", ")}`);
        if (part.inlineData) {
          const inlineData = part.inlineData;
          const audioData = inlineData.data ?? "";

          console.log(`[Gemini Live] Received audio from model, size: ${audioData.length}, mime: ${inlineData.mimeType}`);

          // Send audio to client for playback (receiver hears this)
          this.emit("audio_chunk", {
            data: audioData,
            mimeType: inlineData.mimeType ?? "audio/pcm;rate=24000",
          });
        }
      }
    }

    // Handle input transcription (what the user said)
    // Note: Field name from Gemini Live API can be inputTranscription or inputAudioTranscription
    const inputTrans = (serverContent as any).inputTranscription || (serverContent as any).inputAudioTranscription;
    if (inputTrans?.text) {
      const text = inputTrans.text;
      console.log(`[Transcription] Input: "${text}"`);
      this.emit("input_transcription", {
        text,
        role: this.role,
        lang: this.fromLang,
      });
    }

    // Handle output transcription (what Gemini said/translated)
    // Note: Field name from Gemini Live API can be outputTranscription or outputAudioTranscription
    const outputTrans = (serverContent as any).outputTranscription || (serverContent as any).outputAudioTranscription;
    if (outputTrans?.text) {
      const text = outputTrans.text;
      console.log(`[Transcription] Output: "${text}"`);
      this.emit("output_transcription", {
        text,
        role: this.role,
        lang: this.toLang,
      });
    }

    // Handle barge-in: user started speaking while model was responding
    if (serverContent.interrupted) {
      console.log("Barge-in detected — model response interrupted");
      this.emit("interrupted");
      return;
    }

    if (serverContent.turnComplete) {
      // Small delay to allow any pending transcription events to be processed
      // Gemini Live sometimes sends transcription in the same message as turnComplete
      setTimeout(() => {
        this.emit("turn_complete", {
          role: this.role,
          fromLang: this.fromLang,
          toLang: this.toLang,
        });
      }, 50);
    }
  }

  sendAudio(base64Pcm: string): void {
    if (!this.session || !this.isActive) return;

    this.audioChunkCount++;
    this.resetIdleTimer();

    // Log every 10th chunk to avoid spam
    if (this.audioChunkCount % 10 === 1) {
      console.log(`[Gemini Live] Sending audio chunk #${this.audioChunkCount}, size: ${base64Pcm.length}`);
    }

    try {
      this.session.sendRealtimeInput({
        media: {
          data: base64Pcm,
          mimeType: "audio/pcm;rate=16000",
        },
      });
    } catch (err) {
      console.error("Error sending audio:", err);
      const classified = classifyGeminiError(err);
      if (!classified.retryable) {
        this.emit("error", classified.error);
        this.close();
      }
    }
  }

  // Signal start of speech activity (for manual VAD mode)
  sendActivityStart(): void {
    if (!this.session || !this.isActive) return;
    try {
      this.session.sendRealtimeInput({ activityStart: {} });
      console.log("[Live] Activity start signaled");
    } catch (err) {
      console.error("Error sending activityStart:", err);
    }
  }

  // Signal end of speech activity - triggers model response
  sendActivityEnd(): void {
    if (!this.session || !this.isActive) return;
    try {
      this.session.sendRealtimeInput({ activityEnd: {} });
      console.log("[Live] Activity end signaled - model should respond now");
    } catch (err) {
      console.error("Error sending activityEnd:", err);
    }
  }

  sendText(text: string): void {
    if (!this.session || !this.isActive) return;
    this.resetIdleTimer();

    try {
      this.session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
      });
    } catch (err) {
      console.error("Error sending text:", err);
      const classified = classifyGeminiError(err);
      this.emit("error", classified.error);
    }
  }

  close(): void {
    this.isActive = false;
    this.clearTimers();

    if (this.session) {
      try {
        this.session.close();
      } catch {
        // Ignore close errors
      }
      this.session = null;
    }
    this.removeAllListeners();
    console.log(
      `Live session stats: ${this.audioChunkCount} audio chunks processed`
    );
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log("Live session idle timeout reached");
      this.emit("error", "Session timed out due to inactivity. Please start again.");
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  private startSessionTimer() {
    this.sessionTimer = setTimeout(() => {
      console.log("Live session max duration reached");
      this.emit(
        "error",
        "Maximum session duration reached (10 minutes). Please start a new session."
      );
      this.close();
    }, MAX_SESSION_MS);
  }

  private clearTimers() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  getRole(): "doctor" | "patient" {
    return this.role;
  }

  getGender(): Gender {
    return this.gender;
  }

  getVoiceModel(): string {
    return getVoiceForRole(this.role, this.gender);
  }

  getFromLang(): string {
    return this.fromLang;
  }

  getToLang(): string {
    return this.toLang;
  }

  isConnected(): boolean {
    return this.isActive && this.session !== null;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }
}
