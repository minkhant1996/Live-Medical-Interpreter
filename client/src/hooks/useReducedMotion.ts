/**
 * useReducedMotion Hook
 *
 * Respects user's motion preferences for accessibility.
 * Returns true if user prefers reduced motion (prefers-reduced-motion: reduce)
 *
 * Usage:
 * ```tsx
 * const shouldReduceMotion = useReducedMotion();
 *
 * <motion.div
 *   animate={shouldReduceMotion ? {} : { scale: 1.05 }}
 *   transition={shouldReduceMotion ? { duration: 0 } : springConfig}
 * />
 * ```
 */

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [shouldReduce, setShouldReduce] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Set initial value
    setShouldReduce(mediaQuery.matches);

    // Listen for changes
    const handler = (event: MediaQueryListEvent) => {
      setShouldReduce(event.matches);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }

    // Fallback for older browsers
    mediaQuery.addListener(handler);
    return () => mediaQuery.removeListener(handler);
  }, []);

  return shouldReduce;
}
