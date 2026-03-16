import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TranscriptEntry, SummaryResponse, SupportedLang, RoomInfo, AuthUser } from "../types";
import { getLangLabel } from "../types";
import { staggerContainer, fadeInUp, skeletonPulse, buttonHover, buttonTap, cardHoverLift } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  cachedSummary?: SummaryResponse | null;
  onSummaryGenerated?: (summary: SummaryResponse) => void;
  room?: RoomInfo | null;
  user?: AuthUser | null;
}

export default function SummaryView({
  transcripts,
  doctorLang,
  patientLang,
  cachedSummary,
  onSummaryGenerated,
  room,
  user,
}: Props) {
  // Use cached summary if available, otherwise local state
  const [localSummary, setLocalSummary] = useState<SummaryResponse | null>(null);
  const summary = cachedSummary || localSummary;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function generateSummary() {
    if (transcripts.length === 0) {
      setError("No conversation to summarize. Start interpreting first.");
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripts, doctorLang, patientLang }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Failed to generate summary (${res.status})`);
      }

      const data: SummaryResponse = await res.json();
      setLocalSummary(data);
      onSummaryGenerated?.(data);

      // Save to server if we have room and user (doctor only)
      if (room?.code && user?.token && user?.role === "doctor") {
        try {
          await fetch(`/api/rooms/${room.code}/summary`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({
              summaryLang1: data.summaryLang1,
              summaryLang2: data.summaryLang2,
              lang1Label: data.lang1Label,
              lang2Label: data.lang2Label,
            }),
          });
          console.log("Summary saved to server");
        } catch (saveErr) {
          console.error("Failed to save summary to server:", saveErr);
          // Don't show error to user - the summary was generated successfully
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to generate summary. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="summary-view">
      <motion.div
        className="summary-header"
        variants={shouldReduceMotion ? {} : fadeInUp}
        initial="hidden"
        animate="visible"
      >
        <h2>Visit Summary</h2>
        <p>Generate a bilingual summary of the conversation.</p>
      </motion.div>

      {transcripts.length === 0 && !summary && (
        <motion.p
          className="summary-empty"
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
        >
          No conversation recorded yet. Use the Interpreter tab first.
        </motion.p>
      )}

      {/* Only show Generate button to doctors, and only if no summary exists yet */}
      {user?.role === "doctor" && !summary && (
        <motion.button
          className="btn-primary btn-large"
          onClick={generateSummary}
          disabled={loading || transcripts.length === 0}
          aria-label={loading ? "Generating summary..." : "Generate visit summary"}
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
          whileHover={shouldReduceMotion || loading || transcripts.length === 0 ? {} : buttonHover}
          whileTap={shouldReduceMotion || loading || transcripts.length === 0 ? {} : buttonTap}
        >
          {loading ? "Generating..." : "Generate Summary"}
        </motion.button>
      )}

      {/* Patient sees message if no summary exists */}
      {user?.role === "patient" && !summary && (
        <motion.p
          className="summary-empty"
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
        >
          Waiting for doctor to generate the summary...
        </motion.p>
      )}

      {error && (
        <motion.div
          className="status-bar status-error"
          role="alert"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}

      {/* Skeleton loading state */}
      {loading && !shouldReduceMotion && (
        <div className="summary-results">
          {[1, 2].map((i) => (
            <motion.div
              key={i}
              className="summary-card"
              variants={skeletonPulse}
              initial="hidden"
              animate="visible"
              style={{
                height: 120,
                background: "var(--warm-gray-200)",
                borderRadius: "var(--radius-lg)",
              }}
            />
          ))}
        </div>
      )}

      {/* Summary results */}
      <AnimatePresence>
        {summary && !loading && (
          <motion.div
            className="summary-results"
            variants={shouldReduceMotion ? {} : staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.div
              className="summary-card"
              variants={shouldReduceMotion ? {} : fadeInUp}
              whileHover={shouldReduceMotion ? {} : cardHoverLift}
            >
              <h3>{summary.lang1Label}</h3>
              <div className="summary-content" lang={doctorLang}>
                {summary.summaryLang1.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="summary-card"
              variants={shouldReduceMotion ? {} : fadeInUp}
              whileHover={shouldReduceMotion ? {} : cardHoverLift}
            >
              <h3>{summary.lang2Label}</h3>
              <div className="summary-content" lang={patientLang}>
                {summary.summaryLang2.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="summary-disclaimer"
              variants={shouldReduceMotion ? {} : fadeInUp}
            >
              This summary is for communication support only. It is NOT a medical
              record or diagnosis. Please verify all information with your
              healthcare provider.
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
