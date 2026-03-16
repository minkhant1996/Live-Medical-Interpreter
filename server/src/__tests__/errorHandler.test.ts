import { describe, it, expect } from "vitest";
import { classifyGeminiError } from "../middleware/errorHandler";

describe("classifyGeminiError", () => {
  it("classifies rate limit errors", () => {
    const result = classifyGeminiError(new Error("429 Too Many Requests"));
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(10);
  });

  it("classifies rate limit by keyword", () => {
    expect(classifyGeminiError(new Error("rate limit exceeded")).code).toBe("RATE_LIMITED");
    expect(classifyGeminiError(new Error("quota exceeded")).code).toBe("RATE_LIMITED");
  });

  it("classifies auth errors", () => {
    const result = classifyGeminiError(new Error("401 Unauthorized"));
    expect(result.code).toBe("AUTH_ERROR");
    expect(result.retryable).toBe(false);
  });

  it("classifies 403 and api key errors as auth", () => {
    expect(classifyGeminiError(new Error("403 Forbidden")).code).toBe("AUTH_ERROR");
    expect(classifyGeminiError(new Error("Invalid API key")).code).toBe("AUTH_ERROR");
  });

  it("classifies service unavailable", () => {
    const result = classifyGeminiError(new Error("503 Service Unavailable"));
    expect(result.code).toBe("SERVICE_UNAVAILABLE");
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(5);
  });

  it("classifies overloaded as service unavailable", () => {
    expect(classifyGeminiError(new Error("model overloaded")).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("classifies timeout errors", () => {
    const result = classifyGeminiError(new Error("request timeout"));
    expect(result.code).toBe("TIMEOUT");
    expect(result.retryable).toBe(true);
  });

  it("classifies deadline as timeout", () => {
    expect(classifyGeminiError(new Error("deadline exceeded")).code).toBe("TIMEOUT");
  });

  it("classifies safety filter errors", () => {
    const result = classifyGeminiError(new Error("content blocked by safety filter"));
    expect(result.code).toBe("SAFETY_FILTER");
    expect(result.retryable).toBe(false);
  });

  it("classifies invalid input", () => {
    const result = classifyGeminiError(new Error("400 Bad Request"));
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.retryable).toBe(false);
  });

  it("returns INTERNAL_ERROR for unknown errors", () => {
    const result = classifyGeminiError(new Error("something weird happened"));
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(3);
  });

  it("handles non-Error objects", () => {
    const result = classifyGeminiError("string error");
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("handles null/undefined", () => {
    const result = classifyGeminiError(null);
    expect(result.code).toBe("INTERNAL_ERROR");
  });
});
