import { useState, useEffect } from "react";
import type { AuthUser } from "../types";

interface SessionHistory {
  id: string;
  roomCode: string;
  date: string;
  doctorName: string;
  patientName: string;
  duration: string;
  status: "completed" | "active" | "abandoned";
  hasCertificate: boolean;
  summary?: string;
}

interface Props {
  user: AuthUser;
  onBack: () => void;
  onViewSession: (sessionId: string) => void;
}

export default function HistoryPage({ user, onBack, onViewSession }: Props) {
  const [sessions, setSessions] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  function handleViewSession(roomCode: string) {
    if (loadingSession) return; // Prevent multiple clicks
    setLoadingSession(roomCode);
    onViewSession(roomCode);
  }

  async function loadHistory() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rooms/history", {
        headers: { Authorization: `Bearer ${user.token}` },
      });

      if (!res.ok) {
        throw new Error("Failed to load history");
      }

      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load history:", err);
      setError("Failed to load session history");
      // Show mock data for now
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  const isDoctor = user.role === "doctor";

  return (
    <div className="history-page">
      <div className="history-header">
        <button className="btn-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1>Session History</h1>
      </div>

      <div className="history-content">
        {loading && (
          <div className="history-loading">
            <span className="spinner-lg" />
            <p>Loading history...</p>
          </div>
        )}

        {error && (
          <div className="history-error">
            <p>{error}</p>
            <button className="btn-secondary" onClick={loadHistory}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="history-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3>No sessions yet</h3>
            <p>Your consultation history will appear here</p>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className={`history-grid ${loadingSession ? "loading-session" : ""}`}>
            {sessions.map((session) => {
              const isThisLoading = loadingSession === session.roomCode;
              const isDisabled = loadingSession && !isThisLoading;

              return (
                <div
                  key={session.id}
                  className={`history-card ${session.status} ${isThisLoading ? "loading" : ""} ${isDisabled ? "disabled" : ""}`}
                  onClick={() => !isDisabled && handleViewSession(session.roomCode)}
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  onKeyDown={(e) => e.key === "Enter" && !isDisabled && handleViewSession(session.roomCode)}
                  aria-label={`View session with ${isDoctor ? session.patientName : session.doctorName}`}
                  aria-disabled={isDisabled || undefined}
                >
                  {isThisLoading && (
                    <div className="history-card-loading">
                      <span className="spinner" />
                      <span>Loading session...</span>
                    </div>
                  )}

                  <div className="history-card-header">
                    <span className={`status-badge ${session.status}`}>
                      {session.status}
                    </span>
                    <span className="history-date">{session.date}</span>
                  </div>

                  <div className="history-card-body">
                    <div className="history-participants">
                      <span className="participant-label">
                        {isDoctor ? "Patient" : "Doctor"}:
                      </span>
                      <span className="participant-name">
                        {isDoctor ? session.patientName : session.doctorName}
                      </span>
                    </div>

                    <div className="history-meta">
                      <span className="history-code">#{session.roomCode}</span>
                      {session.duration && (
                        <span className="history-duration">{session.duration}</span>
                      )}
                    </div>

                    {session.summary && (
                      <p className="history-summary">{session.summary}</p>
                    )}
                  </div>

                  <div className="history-card-footer">
                    {session.hasCertificate && (
                      <span className="history-badge cert">Certificate</span>
                    )}
                    <span className="history-badge chat">Chat</span>
                    {isDoctor && <span className="history-badge summary">Summary</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
