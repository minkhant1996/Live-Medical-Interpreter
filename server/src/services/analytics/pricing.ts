/**
 * Pricing Module
 * Cost calculation for different AI models and services
 *
 * Pricing as of 2025 - Update periodically
 */

// ══════════════════════════════════════════════════════════════════════════════
// MODEL PRICING (per 1 million tokens)
// ══════════════════════════════════════════════════════════════════════════════

export interface ModelPricing {
  inputPerMillion: number;   // USD per 1M input tokens
  outputPerMillion: number;  // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini 2.5 Flash (text)
  "gemini-2.5-flash": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  "models/gemini-2.5-flash-preview-05-20": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },

  // Gemini 2.5 Flash (audio input - more expensive)
  "gemini-2.5-flash-audio": {
    inputPerMillion: 0.60,
    outputPerMillion: 0.30,
  },

  // Gemini 2.5 Flash Live API (Native Audio) - Real-time audio
  // Input audio: $3/1M tokens, Output audio: $12/1M tokens
  "gemini-2.5-flash-native-audio": {
    inputPerMillion: 3.00,
    outputPerMillion: 12.00,
  },
  "models/gemini-2.5-flash-native-audio-preview-12-2025": {
    inputPerMillion: 3.00,
    outputPerMillion: 12.00,
  },

  // Gemini 3.1 Flash Lite (very cheap - used for verification)
  "gemini-3.1-flash-lite": {
    inputPerMillion: 0.02,
    outputPerMillion: 0.08,
  },
  "models/gemini-3.1-flash-lite": {
    inputPerMillion: 0.02,
    outputPerMillion: 0.08,
  },

  // Gemini 2.0 Flash (fallback pricing)
  "gemini-2.0-flash": {
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  },

  // Default fallback
  "default": {
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// TTS PRICING (per character)
// ══════════════════════════════════════════════════════════════════════════════

export const TTS_PRICING = {
  // Google Cloud TTS Standard voices
  standardPerChar: 0.000004,      // $4 per 1M characters

  // Google Cloud TTS Neural/WaveNet voices
  neuralPerChar: 0.000016,        // $16 per 1M characters

  // Gemini TTS fallback (estimate based on token usage)
  geminiPerChar: 0.000001,        // Approximation
};

// ══════════════════════════════════════════════════════════════════════════════
// COST CALCULATION FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate cost for Gemini API token usage
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Find matching pricing, with fallbacks
  let pricing = MODEL_PRICING[model];

  if (!pricing) {
    // Try partial match
    const modelLower = model.toLowerCase();
    if (modelLower.includes("native-audio")) {
      pricing = MODEL_PRICING["gemini-2.5-flash-native-audio"];
    } else if (modelLower.includes("flash-lite") || modelLower.includes("3.1")) {
      pricing = MODEL_PRICING["gemini-3.1-flash-lite"];
    } else if (modelLower.includes("2.5-flash")) {
      pricing = MODEL_PRICING["gemini-2.5-flash"];
    } else {
      pricing = MODEL_PRICING["default"];
    }
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return roundToMicrocents(inputCost + outputCost);
}

/**
 * Calculate cost for audio input (different rate than text)
 */
export function calculateAudioTokenCost(
  inputTokens: number,
  outputTokens: number,
  isLiveSession: boolean = false
): number {
  const model = isLiveSession
    ? "gemini-2.5-flash-native-audio"
    : "gemini-2.5-flash-audio";

  return calculateTokenCost(model, inputTokens, outputTokens);
}

/**
 * Calculate cost for TTS synthesis
 */
export function calculateTtsCost(
  charCount: number,
  options: {
    isNeural?: boolean;
    isGeminiFallback?: boolean;
  } = {}
): number {
  const { isNeural = true, isGeminiFallback = false } = options;

  let rate: number;
  if (isGeminiFallback) {
    rate = TTS_PRICING.geminiPerChar;
  } else if (isNeural) {
    rate = TTS_PRICING.neuralPerChar;
  } else {
    rate = TTS_PRICING.standardPerChar;
  }

  return roundToMicrocents(charCount * rate);
}

/**
 * Estimate tokens from text length
 * Rule of thumb: ~4 characters per token for English, ~2-3 for other languages
 */
export function estimateTokens(text: string, lang?: string): number {
  const charsPerToken = isLatinScript(lang) ? 4 : 2.5;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate audio tokens from duration
 * Gemini Live processes audio at ~25 tokens per second
 */
export function estimateAudioTokens(durationMs: number): number {
  const seconds = durationMs / 1000;
  return Math.ceil(seconds * 25);
}

/**
 * Estimate image tokens based on size
 * Gemini charges based on image resolution
 */
export function estimateImageTokens(
  widthPx?: number,
  heightPx?: number,
  sizeBytes?: number
): number {
  // If dimensions known, use Gemini's formula
  if (widthPx && heightPx) {
    // Gemini uses ~765 tokens for a 512x512 image
    // Scales with image area
    const area = widthPx * heightPx;
    const baseArea = 512 * 512;
    return Math.ceil((area / baseArea) * 765);
  }

  // Fallback: estimate from file size
  if (sizeBytes) {
    // Rough estimate: ~1 token per 100 bytes
    return Math.ceil(sizeBytes / 100);
  }

  // Default for unknown image
  return 1000;
}

// ══════════════════════════════════════════════════════════════════════════════
// COST REPORTING HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Format cost for display (always in USD)
 */
export function formatCost(costUsd: number): string {
  if (costUsd < 0.0001) return `$0.0000`;
  if (costUsd < 0.01) return `$${costUsd.toFixed(6)}`;
  return `$${costUsd.toFixed(4)}`;
}

/**
 * Calculate cost breakdown by category
 */
export function calculateCostBreakdown(events: Array<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}>): Record<string, { cost: number; percentage: number }> {
  const totalCost = events.reduce((sum, e) => sum + e.costUsd, 0);

  const byModel: Record<string, number> = {};
  for (const event of events) {
    const model = normalizeModelName(event.model);
    byModel[model] = (byModel[model] || 0) + event.costUsd;
  }

  const breakdown: Record<string, { cost: number; percentage: number }> = {};
  for (const [model, cost] of Object.entries(byModel)) {
    breakdown[model] = {
      cost: roundToMicrocents(cost),
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    };
  }

  return breakdown;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Round to 6 decimal places (micro-cents precision)
 */
function roundToMicrocents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Check if language uses Latin script (affects token estimation)
 */
function isLatinScript(lang?: string): boolean {
  if (!lang) return true;
  const nonLatinLangs = ["my", "th", "km", "lo", "zh", "ja", "ko", "ar", "he", "hi"];
  return !nonLatinLangs.includes(lang.toLowerCase().slice(0, 2));
}

/**
 * Normalize model names for consistent reporting
 */
function normalizeModelName(model: string): string {
  const modelLower = model.toLowerCase();

  if (modelLower.includes("native-audio")) {
    return "gemini-live-audio";
  }
  if (modelLower.includes("flash-lite") || modelLower.includes("3.1")) {
    return "gemini-3.1-flash-lite";
  }
  if (modelLower.includes("2.5-flash")) {
    return "gemini-2.5-flash";
  }
  if (modelLower.includes("tts") || modelLower.includes("speech")) {
    return "cloud-tts";
  }

  return model;
}

// ══════════════════════════════════════════════════════════════════════════════
// BUDGET ALERTS
// ══════════════════════════════════════════════════════════════════════════════

export interface BudgetConfig {
  dailyLimitUsd: number;
  warningThreshold: number;  // 0-1, e.g., 0.8 = 80%
  alertCallback?: (message: string, currentSpend: number, limit: number) => void;
}

let dailySpend = 0;
let lastResetDate: string | null = null;

/**
 * Track spending and check against budget
 */
export function trackSpending(
  costUsd: number,
  config?: BudgetConfig
): { overBudget: boolean; warningTriggered: boolean } {
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily counter if new day
  if (lastResetDate !== today) {
    dailySpend = 0;
    lastResetDate = today;
  }

  dailySpend += costUsd;

  if (!config) {
    return { overBudget: false, warningTriggered: false };
  }

  const overBudget = dailySpend > config.dailyLimitUsd;
  const warningTriggered = dailySpend > config.dailyLimitUsd * config.warningThreshold;

  if (warningTriggered && config.alertCallback) {
    const message = overBudget
      ? `BUDGET EXCEEDED: $${dailySpend.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)}`
      : `Budget warning: $${dailySpend.toFixed(2)} / $${config.dailyLimitUsd.toFixed(2)} (${((dailySpend / config.dailyLimitUsd) * 100).toFixed(1)}%)`;

    config.alertCallback(message, dailySpend, config.dailyLimitUsd);
  }

  return { overBudget, warningTriggered };
}

/**
 * Get current daily spend
 */
export function getDailySpend(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (lastResetDate !== today) {
    return 0;
  }
  return dailySpend;
}
