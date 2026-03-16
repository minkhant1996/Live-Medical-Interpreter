/**
 * LLM Integration Tests with Performance Tracking
 *
 * These tests call the actual Gemini API and record:
 * - Response latency
 * - Token usage (input/output)
 * - Cost estimation
 * - Success/failure rates
 *
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * 1. Copy .env.example to .env
 * 2. Set GOOGLE_API_KEY in .env
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { perfMetrics, LLMMetric } from "./performanceMetrics";
import { genai, translateText, translateTextStreaming, isValidLang, withTimeout } from "../../services/gemini";
import { calculateTokenCost } from "../../services/analytics/pricing";

// Check if API key is available
const API_KEY_AVAILABLE = !!process.env.GOOGLE_API_KEY;

// Skip tests if no API key
const describeWithApi = API_KEY_AVAILABLE ? describe : describe.skip;

// Test data
const TEST_CASES = {
  translation: [
    { text: "Hello, how are you feeling today?", from: "en", to: "th", description: "Simple greeting" },
    { text: "I have a headache and feel dizzy.", from: "en", to: "my", description: "Symptoms description" },
    { text: "Please take this medicine twice a day after meals.", from: "en", to: "vi", description: "Medical instruction" },
    { text: "ฉันมีอาการปวดท้องมาสามวันแล้ว", from: "th", to: "en", description: "Thai to English" },
    { text: "Do you have any allergies to medications?", from: "en", to: "zh", description: "Allergy question" },
  ],
  consultation: [
    {
      description: "Simple consultation",
      transcripts: [
        { role: "doctor", original: "What brings you in today?", translated: "အခုဘာကြောင့် လာခဲ့တာလဲ?", originalLang: "en", translatedLang: "my" },
        { role: "patient", original: "ခေါင်းကိုက်တယ်", translated: "I have a headache", originalLang: "my", translatedLang: "en" },
        { role: "doctor", original: "How long have you had this headache?", translated: "ခေါင်းကိုက်တာ ဘယ်လောက်ကြာပြီလဲ?", originalLang: "en", translatedLang: "my" },
      ],
    },
  ],
};

// Helper to track LLM call performance
async function trackLLMCall<T>(
  testName: string,
  operation: string,
  model: string,
  fn: () => Promise<{ result: T; inputTokens: number; outputTokens: number }>
): Promise<T> {
  const startTime = Date.now();
  let success = true;
  let errorMsg: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let result: T;

  try {
    const response = await fn();
    result = response.result;
    inputTokens = response.inputTokens;
    outputTokens = response.outputTokens;
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latencyMs = Date.now() - startTime;
    const totalTokens = inputTokens + outputTokens;
    const costUsd = calculateTokenCost(model, inputTokens, outputTokens);

    const metric: LLMMetric = {
      testName,
      operation,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs,
      costUsd,
      success,
      error: errorMsg,
      timestamp: new Date(),
    };

    perfMetrics.record(metric);
  }

  return result!;
}

// Estimate tokens for text (rough approximation)
function estimateTokens(text: string): number {
  // ~4 chars per token for English, ~2 for Asian languages
  const hasAsian = /[\u3000-\u9fff\uac00-\ud7af]/.test(text);
  return Math.ceil(text.length / (hasAsian ? 2 : 4));
}

// Show warning if API key is missing
if (!API_KEY_AVAILABLE) {
  console.warn("\n⚠️  GOOGLE_API_KEY not set - skipping integration tests");
  console.warn("   To run tests: cp .env.example .env && edit .env with your API key\n");
}

describeWithApi("LLM Integration Tests", () => {
  beforeAll(() => {
    perfMetrics.start();
  });

  afterAll(() => {
    perfMetrics.printReport();

    // Export results to JSON file
    const resultsDir = path.join(process.cwd(), "test-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resultsPath = path.join(resultsDir, `llm-performance-${timestamp}.json`);
    fs.writeFileSync(resultsPath, perfMetrics.exportJson());
    console.log(`\n📁 Results exported to: ${resultsPath}\n`);
  });

  describe("Translation API", () => {
    it.each(TEST_CASES.translation)(
      "translates: $description ($from -> $to)",
      async ({ text, from, to, description }) => {
        const result = await trackLLMCall(
          `Translation: ${description}`,
          "translate_text",
          "gemini-2.5-flash",
          async () => {
            const translated = await withTimeout(
              translateText(text, from, to),
              30_000,
              "translation"
            );
            return {
              result: translated,
              inputTokens: estimateTokens(text),
              outputTokens: estimateTokens(translated),
            };
          }
        );

        expect(result).toBeTruthy();
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      },
      60_000 // 60s timeout per test
    );

    it("handles streaming translation", async () => {
      const text = "Please describe your symptoms in detail.";
      const chunks: string[] = [];

      const result = await trackLLMCall(
        "Streaming Translation",
        "translate_text_streaming",
        "gemini-2.5-flash",
        async () => {
          const translated = await translateTextStreaming(
            text,
            "en",
            "th",
            (delta) => {
              chunks.push(delta);
            }
          );
          return {
            result: translated,
            inputTokens: estimateTokens(text),
            outputTokens: estimateTokens(translated),
          };
        }
      );

      expect(result).toBeTruthy();
      expect(chunks.length).toBeGreaterThan(0); // Should have received streaming chunks
    }, 60_000);
  });

  describe("Consultation Summary", () => {
    it.each(TEST_CASES.consultation)(
      "generates summary: $description",
      async ({ description, transcripts }) => {
        const conversationLog = transcripts
          .map((t) => {
            const speaker = t.role === "doctor" ? "Doctor" : "Patient";
            return `${speaker}: ${t.original}\n[Translation]: ${t.translated}`;
          })
          .join("\n\n");

        const prompt = `You are a medical documentation assistant. Analyze this doctor-patient conversation and produce a structured consultation summary in English.

<DATA field="conversation">
${conversationLog}
</DATA>

Extract information ONLY from the conversation. Respond in JSON format with fields: chiefComplaint, symptoms, diagnosis, medication, doctorInstructions, procedures, followUp, allergies, vitalSigns, notes.`;

        const result = await trackLLMCall(
          `Consultation Summary: ${description}`,
          "consultation_summary",
          "gemini-2.5-flash",
          async () => {
            const response = await withTimeout(
              genai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                  responseMimeType: "application/json",
                  temperature: 0.1,
                },
              }),
              30_000,
              "consultation"
            );

            const text = response.text || "{}";
            return {
              result: JSON.parse(text),
              inputTokens: response.usageMetadata?.promptTokenCount || estimateTokens(prompt),
              outputTokens: response.usageMetadata?.candidatesTokenCount || estimateTokens(text),
            };
          }
        );

        expect(result).toBeTruthy();
        expect(result.chiefComplaint).toBeDefined();
      },
      60_000
    );
  });

  describe("Image Analysis", () => {
    // Using a simple test image (1x1 red pixel PNG in base64)
    const TEST_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    it("analyzes image (placeholder test)", async () => {
      const prompt = `Analyze this image and describe what you see. Respond in JSON format with fields: description, quality, observations.`;

      const result = await trackLLMCall(
        "Image Analysis",
        "image_analysis",
        "gemini-2.5-flash",
        async () => {
          const response = await withTimeout(
            genai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: TEST_IMAGE_BASE64,
                      },
                    },
                    { text: prompt },
                  ],
                },
              ],
              config: {
                responseMimeType: "application/json",
                temperature: 0.2,
              },
            }),
            30_000,
            "imageAnalysis"
          );

          const text = response.text || "{}";
          return {
            result: JSON.parse(text),
            inputTokens: response.usageMetadata?.promptTokenCount || 1000,
            outputTokens: response.usageMetadata?.candidatesTokenCount || 100,
          };
        }
      );

      expect(result).toBeTruthy();
    }, 60_000);
  });

  describe("Verification (with thinking)", () => {
    it("verifies summary grounding", async () => {
      const summary = {
        chiefComplaint: "Headache",
        symptoms: ["head pain"],
        diagnosis: "Tension headache",
        medication: [],
        doctorInstructions: ["Rest"],
        procedures: "None",
        followUp: "As needed",
        allergies: "Not discussed",
        vitalSigns: "Not recorded",
        notes: "",
      };

      const transcripts = [
        { role: "patient", original: "I have a headache", translated: "ခေါင်းကိုက်တယ်" },
        { role: "doctor", original: "Get some rest", translated: "အနားယူပါ" },
      ];

      const prompt = `Verify that this summary is grounded in the conversation.

<DATA field="summary">
${JSON.stringify(summary)}
</DATA>

<DATA field="conversation">
${transcripts.map(t => `${t.role}: ${t.original}`).join("\n")}
</DATA>

Check for fabrications or hallucinations. Respond in JSON with: changes (array of corrections), passed (boolean).`;

      const result = await trackLLMCall(
        "Verification",
        "clinical_verification",
        "gemini-2.5-flash",
        async () => {
          const response = await withTimeout(
            genai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            }),
            30_000,
            "verification"
          );

          const text = response.text || "{}";
          return {
            result: JSON.parse(text),
            inputTokens: response.usageMetadata?.promptTokenCount || estimateTokens(prompt),
            outputTokens: response.usageMetadata?.candidatesTokenCount || estimateTokens(text),
          };
        }
      );

      expect(result).toBeTruthy();
      expect(typeof result.passed).toBe("boolean");
    }, 60_000);
  });

  describe("Concurrent Requests", () => {
    it("handles multiple concurrent translations", async () => {
      const texts = [
        "How are you?",
        "What is your name?",
        "Where does it hurt?",
        "Take deep breaths",
        "Any questions?",
      ];

      const startTime = Date.now();

      const results = await Promise.all(
        texts.map((text, i) =>
          trackLLMCall(
            `Concurrent Translation ${i + 1}`,
            "translate_concurrent",
            "gemini-2.5-flash",
            async () => {
              const translated = await translateText(text, "en", "th");
              return {
                result: translated,
                inputTokens: estimateTokens(text),
                outputTokens: estimateTokens(translated),
              };
            }
          )
        )
      );

      const totalTime = Date.now() - startTime;

      expect(results).toHaveLength(texts.length);
      results.forEach((r) => expect(r).toBeTruthy());

      console.log(`\n⚡ Concurrent test: ${texts.length} requests in ${totalTime}ms (${(totalTime / texts.length).toFixed(0)}ms avg)\n`);
    }, 120_000);
  });
});
