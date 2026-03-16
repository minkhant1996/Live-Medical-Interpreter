import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../types";
import { getLangLabel } from "../types";

interface Props {
  transcripts: TranscriptEntry[];
  inputMode?: "voice" | "text";
}

export default function TranscriptPanel({ transcripts, inputMode = "voice" }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  if (transcripts.length === 0) {
    return (
      <div className="transcript-panel transcript-empty" role="region" aria-label="Conversation transcript">
        {inputMode === "voice" ? (
          <>
            <p>Tap a button above to start speaking.</p>
            <p>Transcripts will appear here.</p>
          </>
        ) : (
          <>
            <p>Type a message and press Send.</p>
            <p>Transcripts will appear here.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="transcript-panel" role="log" aria-label="Conversation transcript" aria-live="polite">
      {transcripts.map((t) => (
        <div key={t.id} className={`transcript-entry transcript-${t.role}`}>
          <div className="transcript-header">
            <span className={`transcript-role role-${t.role}`}>
              {t.role === "doctor" ? "Doctor" : "Patient"}
            </span>
            <span className="transcript-time">
              {new Date(t.timestamp).toLocaleTimeString("en-US")}
            </span>
          </div>
          <div className="transcript-original" lang={t.originalLang}>
            <span className="lang-tag">{getLangLabel(t.originalLang)}</span>
            {t.original}
          </div>
          <div className="transcript-translated" lang={t.translatedLang}>
            <span className="lang-tag">{getLangLabel(t.translatedLang)}</span>
            {t.translated}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
