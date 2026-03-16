import type { Request, Response, NextFunction } from "express";

export interface ApiError {
  error: string;
  code: string;
  retryable: boolean;
  retryAfter?: number;
}

// Classify Gemini API errors into actionable error responses
export function classifyGeminiError(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Rate limited by Gemini
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) {
    return {
      error: "Service is temporarily busy. Please wait a moment and try again.",
      code: "RATE_LIMITED",
      retryable: true,
      retryAfter: 10,
    };
  }

  // Authentication / API key issues
  if (lower.includes("401") || lower.includes("403") || lower.includes("api key")) {
    return {
      error: "Service authentication error. Please contact support.",
      code: "AUTH_ERROR",
      retryable: false,
    };
  }

  // Model overloaded
  if (lower.includes("503") || lower.includes("overloaded") || lower.includes("unavailable")) {
    return {
      error: "Translation service is temporarily unavailable. Please try again shortly.",
      code: "SERVICE_UNAVAILABLE",
      retryable: true,
      retryAfter: 5,
    };
  }

  // Timeout
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return {
      error: "Request timed out. Please try a shorter message or try again.",
      code: "TIMEOUT",
      retryable: true,
      retryAfter: 2,
    };
  }

  // Content safety filter
  if (lower.includes("safety") || lower.includes("blocked") || lower.includes("harm")) {
    return {
      error: "Content could not be processed due to safety filters. Please rephrase.",
      code: "SAFETY_FILTER",
      retryable: false,
    };
  }

  // Invalid input
  if (lower.includes("400") || lower.includes("invalid")) {
    return {
      error: "Invalid request. Please check your input and try again.",
      code: "INVALID_INPUT",
      retryable: false,
    };
  }

  // Generic server error
  return {
    error: "An unexpected error occurred. Please try again.",
    code: "INTERNAL_ERROR",
    retryable: true,
    retryAfter: 3,
  };
}

// Express error handler middleware
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Log only error name and message, not full stack or request body (may contain PHI)
  console.error("Unhandled error:", { name: err.name, message: err.message?.slice(0, 200) });

  const apiError = classifyGeminiError(err);
  const status =
    apiError.code === "RATE_LIMITED" ? 429 :
    apiError.code === "AUTH_ERROR" ? 403 :
    apiError.code === "SERVICE_UNAVAILABLE" ? 503 :
    apiError.code === "INVALID_INPUT" ? 400 :
    500;

  if (apiError.retryAfter) {
    res.setHeader("Retry-After", apiError.retryAfter);
  }

  res.status(status).json(apiError);
}

// Wrap async route handlers to catch errors
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
