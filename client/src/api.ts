// API configuration for development with ngrok or other external hosts

// Base URL for API calls:
// - VITE_API_URL env var for ngrok/external (e.g., "https://brookai.ngrok.dev")
// - Empty string for same-origin (production or local dev with proxy)
export const API_BASE = import.meta.env.VITE_API_URL || "";

// Helper to build API URLs
export function apiUrl(path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

// Wrapper for fetch that adds API base URL for /api paths
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/api")) {
    return fetch(`${API_BASE}${input}`, init);
  }
  return fetch(input, init);
}

// Install global fetch override (call once at app startup)
export function installApiFetch(): void {
  if (API_BASE) {
    const originalFetch = window.fetch;
    window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      if (typeof input === "string" && input.startsWith("/api")) {
        return originalFetch(`${API_BASE}${input}`, init);
      }
      return originalFetch(input, init);
    };
    console.log(`[API] Using external API: ${API_BASE}`);
  }
}
