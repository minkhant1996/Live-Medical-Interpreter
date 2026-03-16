import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import mermaid from "mermaid";
import type { AuthUser } from "../types";
import { pageEnter, fadeInUp, staggerContainerFast, scaleIn } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#e3f2fd",
    primaryTextColor: "#1565c0",
    primaryBorderColor: "#1976d2",
    lineColor: "#64b5f6",
    secondaryColor: "#fff3e0",
    tertiaryColor: "#e8f5e9",
    background: "#ffffff",
    mainBkg: "#e3f2fd",
    secondBkg: "#fff3e0",
    fontFamily: "inherit",
  },
  flowchart: {
    curve: "basis",
    padding: 20,
  },
});

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

interface AnalyticsSummary {
  period: string;
  totalSessions: number;
  totalUsers: number;
  totalMessages: number;
  totalCostUsd: number;
  errorRate: number;
  topFeatures: { feature: string; count: number }[];
  topLanguagePairs: { pair: string; count: number }[];
}

interface CostData {
  startDate: string;
  endDate: string;
  totalCostUsd: number;
  totalCalls: number;
  formattedCost: string;
  byModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }>;
  byEventType: Record<string, { cost: number; calls: number }>;
}

interface DailyCost {
  date: string;
  totalCostUsd: number;
  totalCalls: number;
  totalTokens: number;
}

interface SessionMetrics {
  id: string;
  sessionId: string;
  roomCode: string;
  doctorUsername: string;
  patientUsername: string;
  doctorLang: string;
  patientLang: string;
  totalMessages: number;
  totalCostUsd: number;
  durationSeconds: number;
  status: string;
  startedAt: { _seconds: number };
}

interface LiveAgentCall {
  callId: string;
  timestamp: string;
  userId: string;
  username: string;
  sessionId: string;
  roomCode: string;
  speakerRole: "doctor" | "patient";
  speakerGender: "male" | "female";
  voiceModel: string;
  fromLang: string;
  fromLangName: string;
  toLang: string;
  toLangName: string;
  systemPrompt: string;
  userText: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  processingDurationMs: number;
  costUsd: number;
  inputAudioDurationMs: number;
  outputAudioDurationMs: number;
  success: boolean;
  errorMessage: string | null;
}

interface BufferStatus {
  status: string;
  pendingEvents: number;
  activeSessions: number;
  todaySpend: number;
  todaySpendFormatted: string;
}

type TabId = "overview" | "costs" | "sessions" | "live-agent" | "features" | "architecture";

export default function AdminDashboard({ user, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");

  // Data states
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [sessions, setSessions] = useState<SessionMetrics[]>([]);
  const [liveAgentCalls, setLiveAgentCalls] = useState<LiveAgentCall[]>([]);
  const [bufferStatus, setBufferStatus] = useState<BufferStatus | null>(null);

  // Detail modal state
  const [selectedCall, setSelectedCall] = useState<LiveAgentCall | null>(null);

  const shouldReduceMotion = useReducedMotion();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
      };

      // Fetch all data in parallel
      const [summaryRes, costsRes, dailyRes, sessionsRes, statusRes, liveAgentRes] = await Promise.all([
        fetch(`/api/analytics/summary?period=${period}`, { headers }),
        fetch("/api/analytics/costs", { headers }),
        fetch("/api/analytics/costs/daily?days=7", { headers }),
        fetch("/api/analytics/sessions?limit=20", { headers }),
        fetch("/api/analytics/status", { headers }),
        fetch("/api/analytics/live-agent-calls?limit=50", { headers }),
      ]);

      if (!summaryRes.ok || !costsRes.ok || !dailyRes.ok || !sessionsRes.ok || !statusRes.ok) {
        throw new Error("Failed to fetch analytics data");
      }

      const [summaryData, costsData, dailyData, sessionsData, statusData] = await Promise.all([
        summaryRes.json(),
        costsRes.json(),
        dailyRes.json(),
        sessionsRes.json(),
        statusRes.json(),
      ]);

      // Live agent calls might not be available yet
      let liveAgentData = { calls: [] };
      if (liveAgentRes.ok) {
        liveAgentData = await liveAgentRes.json();
      }

      setSummary(summaryData);
      setCostData(costsData);
      setDailyCosts(dailyData.daily || []);
      setSessions(sessionsData.sessions || []);
      setLiveAgentCalls(liveAgentData.calls || []);
      setBufferStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [user.token, period]);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatCurrency = (value: number) => {
    if (value < 0.0001) return `$0.0000`;
    if (value < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(4)}`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (timestamp: { _seconds: number } | string) => {
    if (typeof timestamp === "string") {
      return new Date(timestamp).toLocaleString();
    }
    return new Date(timestamp._seconds * 1000).toLocaleString();
  };

  return (
    <div className="app admin-dashboard">
      <motion.header
        className="app-header"
        variants={shouldReduceMotion ? {} : pageEnter}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          variants={shouldReduceMotion ? {} : fadeInUp}
          className="app-brand"
          onClick={onLogout}
          style={{ cursor: "pointer" }}
          title="Return to login"
        >
          MedInterpreter
        </motion.h1>
        <motion.p
          className="subtitle"
          variants={shouldReduceMotion ? {} : fadeInUp}
          transition={{ delay: 0.05 }}
        >
          Real-time Medical Interpretation
        </motion.p>
        <motion.p
          className="subtitle admin-subtitle"
          variants={shouldReduceMotion ? {} : fadeInUp}
          transition={{ delay: 0.1 }}
        >
          Analytics Dashboard | Logged in as <strong>{user.username}</strong>
          {bufferStatus && (
            <span className="buffer-status">
              {" "}| {bufferStatus.pendingEvents} pending events | Today: {bufferStatus.todaySpendFormatted}
            </span>
          )}
        </motion.p>

        <nav className="tabs admin-tabs" role="tablist">
          {[
            { id: "overview" as TabId, label: "Overview" },
            { id: "costs" as TabId, label: "Costs" },
            { id: "sessions" as TabId, label: "Sessions" },
            { id: "live-agent" as TabId, label: "Live Agent" },
            { id: "features" as TabId, label: "Features" },
            { id: "architecture" as TabId, label: "Architecture" },
          ].map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </motion.header>

      <main className="app-main admin-main">
        {loading && !summary ? (
          <div className="loading-container">
            <span className="loading-spinner large"></span>
            <p>Loading analytics...</p>
          </div>
        ) : error ? (
          <motion.div
            className="status-bar status-error"
            variants={shouldReduceMotion ? {} : fadeInUp}
            initial="hidden"
            animate="visible"
          >
            {error}
            <button className="btn-link" onClick={fetchData}>
              Retry
            </button>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            {/* Overview Tab */}
            {activeTab === "overview" && summary && (
              <motion.div
                key="overview"
                className="admin-panel"
                variants={shouldReduceMotion ? {} : staggerContainerFast}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                <div className="period-selector">
                  <label>Period:</label>
                  {(["today", "week", "month"] as const).map((p) => (
                    <button
                      key={p}
                      className={`period-btn ${period === p ? "active" : ""}`}
                      onClick={() => setPeriod(p)}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="stats-grid">
                  <motion.div className="stat-card" variants={shouldReduceMotion ? {} : scaleIn}>
                    <div className="stat-value">{summary.totalSessions}</div>
                    <div className="stat-label">Sessions</div>
                  </motion.div>
                  <motion.div className="stat-card" variants={shouldReduceMotion ? {} : scaleIn}>
                    <div className="stat-value">{summary.totalUsers}</div>
                    <div className="stat-label">Users</div>
                  </motion.div>
                  <motion.div className="stat-card" variants={shouldReduceMotion ? {} : scaleIn}>
                    <div className="stat-value">{summary.totalMessages}</div>
                    <div className="stat-label">Messages</div>
                  </motion.div>
                  <motion.div className="stat-card highlight" variants={shouldReduceMotion ? {} : scaleIn}>
                    <div className="stat-value">{formatCurrency(summary.totalCostUsd)}</div>
                    <div className="stat-label">Total Cost</div>
                  </motion.div>
                  <motion.div className="stat-card" variants={shouldReduceMotion ? {} : scaleIn}>
                    <div className="stat-value">{(summary.errorRate * 100).toFixed(1)}%</div>
                    <div className="stat-label">Error Rate</div>
                  </motion.div>
                </div>

                <div className="analytics-sections">
                  <div className="analytics-section">
                    <h3>Top Features</h3>
                    <ul className="feature-list">
                      {summary.topFeatures.map((f) => (
                        <li key={f.feature}>
                          <span className="feature-name">{f.feature}</span>
                          <span className="feature-count">{f.count}</span>
                        </li>
                      ))}
                      {summary.topFeatures.length === 0 && (
                        <li className="empty">No data yet</li>
                      )}
                    </ul>
                  </div>

                  <div className="analytics-section">
                    <h3>Top Language Pairs</h3>
                    <ul className="feature-list">
                      {summary.topLanguagePairs.map((p) => (
                        <li key={p.pair}>
                          <span className="feature-name">{p.pair.toUpperCase()}</span>
                          <span className="feature-count">{p.count}</span>
                        </li>
                      ))}
                      {summary.topLanguagePairs.length === 0 && (
                        <li className="empty">No data yet</li>
                      )}
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Costs Tab */}
            {activeTab === "costs" && costData && (
              <motion.div
                key="costs"
                className="admin-panel"
                variants={shouldReduceMotion ? {} : staggerContainerFast}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                <div className="cost-summary">
                  <h3>Cost Breakdown (Last 30 Days)</h3>
                  <div className="stats-grid compact">
                    <div className="stat-card highlight">
                      <div className="stat-value">{costData.formattedCost}</div>
                      <div className="stat-label">Total Cost</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{costData.totalCalls.toLocaleString()}</div>
                      <div className="stat-label">API Calls</div>
                    </div>
                  </div>
                </div>

                <div className="analytics-sections">
                  <div className="analytics-section">
                    <h3>Cost by Model</h3>
                    <table className="analytics-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Calls</th>
                          <th>Input Tokens</th>
                          <th>Output Tokens</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(costData.byModel).map(([model, data]) => (
                          <tr key={model}>
                            <td className="model-name">{model}</td>
                            <td>{data.calls.toLocaleString()}</td>
                            <td>{data.inputTokens.toLocaleString()}</td>
                            <td>{data.outputTokens.toLocaleString()}</td>
                            <td className="cost">{formatCurrency(data.cost)}</td>
                          </tr>
                        ))}
                        {Object.keys(costData.byModel).length === 0 && (
                          <tr>
                            <td colSpan={5} className="empty">No data yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="analytics-section">
                    <h3>Daily Costs (Last 7 Days)</h3>
                    <table className="analytics-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Calls</th>
                          <th>Tokens</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyCosts.map((day) => (
                          <tr key={day.date}>
                            <td>{day.date}</td>
                            <td>{day.totalCalls.toLocaleString()}</td>
                            <td>{day.totalTokens.toLocaleString()}</td>
                            <td className="cost">{formatCurrency(day.totalCostUsd)}</td>
                          </tr>
                        ))}
                        {dailyCosts.length === 0 && (
                          <tr>
                            <td colSpan={4} className="empty">No data yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Sessions Tab - Now with Cards */}
            {activeTab === "sessions" && (
              <motion.div
                key="sessions"
                className="admin-panel"
                variants={shouldReduceMotion ? {} : staggerContainerFast}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                <h3>Recent Sessions</h3>
                <div className="session-cards-grid">
                  {sessions.map((session) => (
                    <motion.div
                      key={session.id}
                      className="session-card"
                      variants={shouldReduceMotion ? {} : scaleIn}
                    >
                      <div className="session-card-header">
                        <span className="session-room">{session.roomCode}</span>
                        <span className={`status-badge ${session.status}`}>
                          {session.status}
                        </span>
                      </div>
                      <div className="session-card-body">
                        <div className="session-row">
                          <span className="session-label">Doctor</span>
                          <span className="session-value">{session.doctorUsername}</span>
                        </div>
                        <div className="session-row">
                          <span className="session-label">Patient</span>
                          <span className="session-value">{session.patientUsername}</span>
                        </div>
                        <div className="session-row">
                          <span className="session-label">Languages</span>
                          <span className="session-value lang-pair">
                            {session.doctorLang?.toUpperCase()} ↔ {session.patientLang?.toUpperCase()}
                          </span>
                        </div>
                        <div className="session-row">
                          <span className="session-label">Messages</span>
                          <span className="session-value">{session.totalMessages || 0}</span>
                        </div>
                        <div className="session-row">
                          <span className="session-label">Duration</span>
                          <span className="session-value">{formatDuration(session.durationSeconds || 0)}</span>
                        </div>
                        <div className="session-row">
                          <span className="session-label">Cost</span>
                          <span className="session-value cost">{formatCurrency(session.totalCostUsd || 0)}</span>
                        </div>
                      </div>
                      <div className="session-card-footer">
                        <span className="session-time">
                          {session.startedAt ? formatDate(session.startedAt) : "-"}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                  {sessions.length === 0 && (
                    <div className="empty-state">No sessions recorded yet</div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Live Agent Tab */}
            {activeTab === "live-agent" && (
              <motion.div
                key="live-agent"
                className="admin-panel"
                variants={shouldReduceMotion ? {} : staggerContainerFast}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                <h3>Live Agent Calls</h3>
                <p className="panel-description">
                  Detailed tracking of each translation turn with prompts and responses
                </p>
                <div className="live-agent-cards-grid">
                  {liveAgentCalls.map((call) => (
                    <motion.div
                      key={call.callId}
                      className={`live-agent-card ${call.speakerRole}`}
                      variants={shouldReduceMotion ? {} : scaleIn}
                      onClick={() => setSelectedCall(call)}
                    >
                      <div className="live-agent-card-header">
                        <span className={`speaker-badge ${call.speakerRole}`}>
                          {call.speakerRole === "doctor" ? "Doctor" : "Patient"}
                        </span>
                        <span className="room-badge">{call.roomCode}</span>
                      </div>
                      <div className="live-agent-card-body">
                        <div className="live-agent-row">
                          <span className="live-agent-label">User</span>
                          <span className="live-agent-value">{call.username}</span>
                        </div>
                        <div className="live-agent-row">
                          <span className="live-agent-label">Direction</span>
                          <span className="live-agent-value lang-direction">
                            {call.fromLangName} → {call.toLangName}
                          </span>
                        </div>
                        <div className="live-agent-row">
                          <span className="live-agent-label">Voice</span>
                          <span className="live-agent-value">
                            {call.voiceModel} ({call.speakerGender})
                          </span>
                        </div>
                        <div className="live-agent-row">
                          <span className="live-agent-label">Input</span>
                          <span className="live-agent-value text-preview">
                            {call.userText ? (call.userText.length > 50 ? call.userText.slice(0, 50) + "..." : call.userText) : "(no transcription)"}
                          </span>
                        </div>
                        <div className="live-agent-row">
                          <span className="live-agent-label">Output</span>
                          <span className="live-agent-value text-preview">
                            {call.responseText ? (call.responseText.length > 50 ? call.responseText.slice(0, 50) + "..." : call.responseText) : "(no translation)"}
                          </span>
                        </div>
                        <div className="live-agent-metrics">
                          <div className="metric">
                            <span className="metric-value">{call.inputTokens}</span>
                            <span className="metric-label">In Tkn</span>
                          </div>
                          <div className="metric">
                            <span className="metric-value">{call.outputTokens}</span>
                            <span className="metric-label">Out Tkn</span>
                          </div>
                          <div className="metric">
                            <span className="metric-value">{formatMs(call.processingDurationMs)}</span>
                            <span className="metric-label">Duration</span>
                          </div>
                          <div className="metric highlight">
                            <span className="metric-value">{formatCurrency(call.costUsd)}</span>
                            <span className="metric-label">Cost</span>
                          </div>
                        </div>
                      </div>
                      <div className="live-agent-card-footer">
                        <span className="call-time">{formatDate(call.timestamp)}</span>
                        <button className="btn-view-detail" onClick={(e) => { e.stopPropagation(); setSelectedCall(call); }}>
                          View Detail
                        </button>
                      </div>
                    </motion.div>
                  ))}
                  {liveAgentCalls.length === 0 && (
                    <div className="empty-state">No live agent calls recorded yet</div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Features Tab */}
            {activeTab === "features" && costData && (
              <motion.div
                key="features"
                className="admin-panel"
                variants={shouldReduceMotion ? {} : staggerContainerFast}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0 }}
              >
                <h3>Feature Usage</h3>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Calls</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(costData.byEventType).map(([eventType, data]) => (
                      <tr key={eventType}>
                        <td className="feature-name">{eventType}</td>
                        <td>{data.calls.toLocaleString()}</td>
                        <td className="cost">{formatCurrency(data.cost)}</td>
                      </tr>
                    ))}
                    {Object.keys(costData.byEventType).length === 0 && (
                      <tr>
                        <td colSpan={3} className="empty">No data yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </motion.div>
            )}

            {/* Architecture Tab */}
            {activeTab === "architecture" && (
              <ArchitectureDiagram shouldReduceMotion={shouldReduceMotion} />
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Detail Modal for Live Agent Call */}
      {selectedCall && (
        <div className="modal-overlay" onClick={() => setSelectedCall(null)}>
          <div className="modal-content live-agent-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Live Agent Call Detail</h2>
              <button className="btn-dismiss" onClick={() => setSelectedCall(null)} aria-label="Close">
                &#10005;
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h4>Call Information</h4>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Call ID</span>
                    <span className="detail-value mono">{selectedCall.callId}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Room</span>
                    <span className="detail-value">{selectedCall.roomCode}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">User</span>
                    <span className="detail-value">{selectedCall.username}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Role</span>
                    <span className={`detail-value badge ${selectedCall.speakerRole}`}>
                      {selectedCall.speakerRole}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Gender</span>
                    <span className="detail-value">{selectedCall.speakerGender}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Voice Model</span>
                    <span className="detail-value">{selectedCall.voiceModel || "N/A"}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Timestamp</span>
                    <span className="detail-value">{formatDate(selectedCall.timestamp)}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>Language Direction</h4>
                <div className="lang-direction-display">
                  <span className="lang-from">{selectedCall.fromLangName}</span>
                  <span className="lang-arrow">→</span>
                  <span className="lang-to">{selectedCall.toLangName}</span>
                </div>
              </div>

              <div className="detail-section">
                <h4>Metrics</h4>
                <div className="metrics-grid">
                  <div className="metric-card">
                    <span className="metric-value">{selectedCall.inputTokens}</span>
                    <span className="metric-label">Input Tokens</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{selectedCall.outputTokens}</span>
                    <span className="metric-label">Output Tokens</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{selectedCall.totalTokens}</span>
                    <span className="metric-label">Total Tokens</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{formatMs(selectedCall.processingDurationMs)}</span>
                    <span className="metric-label">Processing Time</span>
                  </div>
                  <div className="metric-card highlight">
                    <span className="metric-value">{formatCurrency(selectedCall.costUsd)}</span>
                    <span className="metric-label">Cost</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{formatMs(selectedCall.inputAudioDurationMs)}</span>
                    <span className="metric-label">Input Audio</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{formatMs(selectedCall.outputAudioDurationMs)}</span>
                    <span className="metric-label">Output Audio</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>System Prompt</h4>
                <pre className="prompt-display">{selectedCall.systemPrompt || "(not available)"}</pre>
              </div>

              <div className="detail-section">
                <h4>Speaker Text (Input Transcription)</h4>
                <div className="text-display">
                  {selectedCall.userText || "(no transcription captured)"}
                </div>
              </div>

              <div className="detail-section">
                <h4>Translation (Output)</h4>
                <div className="text-display">
                  {selectedCall.responseText || "(no translation captured)"}
                </div>
              </div>

              {selectedCall.errorMessage && (
                <div className="detail-section error">
                  <h4>Error</h4>
                  <div className="error-display">{selectedCall.errorMessage}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>Analytics data refreshes every 30 seconds</p>
        <div className="footer-links">
          <button className="btn-link" onClick={fetchData}>
            Refresh Now
          </button>
          <span className="footer-sep" aria-hidden="true">|</span>
          <button className="btn-link" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </footer>
    </div>
  );
}

// Architecture Diagram Component
function ArchitectureDiagram({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  const [activeDiagram, setActiveDiagram] = useState<"system" | "flow" | "audio">("system");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const diagramRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom/pan when diagram changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeDiagram]);

  // Handle zoom with mouse wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.min(Math.max(0.5, prev + delta), 3));
  };

  // Handle pan with mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom controls
  const zoomIn = () => setZoom((prev) => Math.min(prev + 0.2, 3));
  const zoomOut = () => setZoom((prev) => Math.max(prev - 0.2, 0.5));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    if (!isFullscreen) {
      // Reset view when entering fullscreen
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  // Close fullscreen on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const diagrams = {
    system: `flowchart TB
    subgraph Client["Frontend (React + Vite)"]
        direction TB
        DoctorUI["👨‍⚕️ Doctor Interface"]
        PatientUI["👤 Patient Interface"]
        AudioCapture["🎤 Audio Capture"]
        AudioPlayback["🔊 Audio Playback"]
    end

    subgraph Server["Backend (Node.js + Express)"]
        direction TB
        WSServer["WebSocket Server"]
        RestAPI["REST API"]
        AuthMW["Auth Middleware (JWT)"]

        subgraph Services["Services"]
            GeminiLive["Gemini Live Service"]
            GeminiFlash["Gemini Flash Service"]
            STTService["STT Service (Chirp 3)"]
            TTSService["TTS Service"]
            AudioStorage["Audio Storage"]
        end
    end

    subgraph GCP["Google Cloud Platform"]
        direction TB
        GeminiAPI["Gemini 2.5 Flash\\nNative Audio"]
        SpeechAPI["Cloud Speech V2\\nChirp 3"]
        TTSAPI["Cloud TTS"]
        GCS["Cloud Storage"]
        Firestore["Firestore"]
    end

    DoctorUI <-->|"WebSocket"| WSServer
    PatientUI <-->|"WebSocket"| WSServer
    DoctorUI -->|"REST"| RestAPI
    PatientUI -->|"REST"| RestAPI

    AudioCapture --> DoctorUI
    AudioCapture --> PatientUI
    AudioPlayback --> DoctorUI
    AudioPlayback --> PatientUI

    WSServer --> AuthMW
    RestAPI --> AuthMW
    WSServer <--> GeminiLive
    WSServer --> AudioStorage
    RestAPI --> GeminiFlash
    RestAPI --> STTService

    GeminiLive <-->|"Bidirectional"| GeminiAPI
    GeminiFlash --> GeminiAPI
    STTService --> SpeechAPI
    TTSService --> TTSAPI
    AudioStorage <--> GCS
    AuthMW <--> Firestore
    WSServer <--> Firestore

    classDef frontend fill:#e1f5fe,stroke:#01579b
    classDef backend fill:#fff3e0,stroke:#e65100
    classDef gcp fill:#e8f5e9,stroke:#2e7d32

    class DoctorUI,PatientUI,AudioCapture,AudioPlayback frontend
    class WSServer,RestAPI,AuthMW,GeminiLive,GeminiFlash,STTService,TTSService,AudioStorage backend
    class GeminiAPI,SpeechAPI,TTSAPI,GCS,Firestore gcp`,

    flow: `sequenceDiagram
    participant D as 👨‍⚕️ Doctor
    participant C as 📱 Client
    participant WS as 🔌 WebSocket
    participant GL as 🤖 Gemini Live
    participant GCS as 💾 GCS
    participant FS as 🗄️ Firestore
    participant P as 👤 Patient

    Note over D,P: Real-time Translation Flow

    D->>C: Speaks (English)
    C->>WS: audio_chunk (PCM 16kHz)
    WS->>GL: sendAudio(base64)
    GL-->>GL: Process & Translate
    GL->>WS: audio (PCM 24kHz Myanmar)
    GL->>WS: output_transcription
    WS->>GCS: saveTranscriptAudio()
    WS->>FS: saveTranscript()
    WS->>C: audio_chunk + transcript
    C->>P: Plays translated audio

    Note over D,P: End Conversation & Summary

    D->>C: Click "End & Summarize"
    C->>WS: end_conversation
    WS->>FS: getTranscriptsForRoom()
    FS-->>WS: transcripts with audioUrls
    WS->>GCS: Download translated audio
    GCS-->>WS: audio buffers
    WS->>WS: Combine audio (chronological)
    WS->>GL: STT V2 Chirp 3
    GL-->>WS: Transcription
    WS->>GL: summarizeConversation()
    GL-->>WS: Summary
    WS->>C: conversation_summary
    C->>D: Show summary modal
    C->>P: Show summary modal`,

    audio: `flowchart LR
    subgraph Input["Audio Input"]
        A[🎤 Microphone] -->|PCM 16kHz| B[WebSocket]
    end

    subgraph Processing["Gemini Live Processing"]
        B -->|Stream| C[Gemini Live API]
        C -->|Translated Audio| D[PCM 24kHz]
    end

    subgraph Output["Audio Output"]
        D -->|Broadcast| E[🔊 Speaker]
    end

    subgraph Storage["Persistent Storage"]
        C -->|transcription| F[Transcript Entry]
        D -->|audio| G[GCS Bucket]
        F --> H[(Firestore)]
        G -.->|audioUrl| F
    end

    subgraph Summary["Summary Generation"]
        H -->|getTranscripts| I[Combine Audio]
        G -->|Download| I
        I -->|Base64| J[STT Chirp 3]
        J -->|Text| K[Gemini Flash]
        K -->|Summary| L[📋 Certificate]
    end

    classDef input fill:#e3f2fd,stroke:#1976d2
    classDef process fill:#fff3e0,stroke:#ff9800
    classDef output fill:#e8f5e9,stroke:#4caf50
    classDef storage fill:#fce4ec,stroke:#e91e63
    classDef summary fill:#f3e5f5,stroke:#9c27b0

    class A,B input
    class C,D process
    class E output
    class F,G,H storage
    class I,J,K,L summary`,
  };

  useEffect(() => {
    if (diagramRef.current) {
      diagramRef.current.innerHTML = "";
      const id = `mermaid-${Date.now()}`;
      mermaid.render(id, diagrams[activeDiagram]).then(({ svg }) => {
        if (diagramRef.current) {
          diagramRef.current.innerHTML = svg;
        }
      }).catch((err) => {
        console.error("Mermaid render error:", err);
        if (diagramRef.current) {
          diagramRef.current.innerHTML = `<pre style="color: red;">Error rendering diagram: ${err.message}</pre>`;
        }
      });
    }
  }, [activeDiagram]);

  return (
    <motion.div
      key="architecture"
      className="admin-panel architecture-panel"
      variants={shouldReduceMotion ? {} : staggerContainerFast}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0 }}
    >
      <h3>System Architecture</h3>
      <p className="panel-description">
        Visual representation of the MedInterpreter system architecture
      </p>

      <div className="diagram-tabs">
        <button
          className={`diagram-tab ${activeDiagram === "system" ? "active" : ""}`}
          onClick={() => setActiveDiagram("system")}
        >
          System Overview
        </button>
        <button
          className={`diagram-tab ${activeDiagram === "flow" ? "active" : ""}`}
          onClick={() => setActiveDiagram("flow")}
        >
          Message Flow
        </button>
        <button
          className={`diagram-tab ${activeDiagram === "audio" ? "active" : ""}`}
          onClick={() => setActiveDiagram("audio")}
        >
          Audio Pipeline
        </button>
      </div>

      <div className="diagram-controls">
        <button onClick={zoomOut} title="Zoom Out" className="diagram-control-btn">
          −
        </button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn} title="Zoom In" className="diagram-control-btn">
          +
        </button>
        <button onClick={resetView} title="Reset View" className="diagram-control-btn">
          ↺
        </button>
        <button onClick={toggleFullscreen} title="Fullscreen" className="diagram-control-btn fullscreen-btn">
          ⛶
        </button>
      </div>

      <div
        className={`diagram-wrapper ${isFullscreen ? "fullscreen" : ""}`}
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {isFullscreen && (
          <div className="fullscreen-header">
            <div className="fullscreen-tabs">
              <button
                className={`diagram-tab ${activeDiagram === "system" ? "active" : ""}`}
                onClick={() => setActiveDiagram("system")}
              >
                System Overview
              </button>
              <button
                className={`diagram-tab ${activeDiagram === "flow" ? "active" : ""}`}
                onClick={() => setActiveDiagram("flow")}
              >
                Message Flow
              </button>
              <button
                className={`diagram-tab ${activeDiagram === "audio" ? "active" : ""}`}
                onClick={() => setActiveDiagram("audio")}
              >
                Audio Pipeline
              </button>
            </div>
            <div className="fullscreen-controls">
              <button onClick={zoomOut} title="Zoom Out" className="diagram-control-btn">
                −
              </button>
              <span className="zoom-level">{Math.round(zoom * 100)}%</span>
              <button onClick={zoomIn} title="Zoom In" className="diagram-control-btn">
                +
              </button>
              <button onClick={resetView} title="Reset View" className="diagram-control-btn">
                ↺
              </button>
              <button onClick={toggleFullscreen} title="Exit Fullscreen" className="diagram-control-btn close-btn">
                ✕
              </button>
            </div>
          </div>
        )}
        <div
          className="diagram-container"
          ref={diagramRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: isDragging ? "grabbing" : "grab",
          }}
        >
          <div className="loading-diagram">Loading diagram...</div>
        </div>
      </div>

      <div className="architecture-legend">
        <h4>Key Components</h4>
        <div className="legend-grid">
          <div className="legend-item">
            <span className="legend-color frontend"></span>
            <span className="legend-label">Frontend (React + Vite)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color backend"></span>
            <span className="legend-label">Backend (Node.js + Express)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color gcp"></span>
            <span className="legend-label">Google Cloud Platform</span>
          </div>
          <div className="legend-item">
            <span className="legend-color storage"></span>
            <span className="legend-label">Data Storage</span>
          </div>
        </div>

        <h4>Technology Stack</h4>
        <table className="tech-stack-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Technology</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Real-time Translation</td>
              <td>Gemini 2.5 Flash Native Audio</td>
              <td>Speech-to-speech translation</td>
            </tr>
            <tr>
              <td>Post-conversation STT</td>
              <td>Cloud Speech V2 (Chirp 3)</td>
              <td>Auto language detection, accurate transcription</td>
            </tr>
            <tr>
              <td>Summary & Certificate</td>
              <td>Gemini Flash</td>
              <td>Text generation, multilingual output</td>
            </tr>
            <tr>
              <td>Audio Storage</td>
              <td>Cloud Storage</td>
              <td>Temporary storage (24h auto-expiry)</td>
            </tr>
            <tr>
              <td>Database</td>
              <td>Firestore</td>
              <td>Users, rooms, transcripts, certificates</td>
            </tr>
            <tr>
              <td>Real-time Communication</td>
              <td>WebSocket (ws)</td>
              <td>Bidirectional audio streaming</td>
            </tr>
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
