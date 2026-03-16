import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { AuthUser, RoomInfo, SupportedLang, DoctorProfile } from "../types";
import { LANG_OPTIONS, getLangLabel } from "../types";
import {
  pageEnter,
  fadeInUp,
  slideInFromLeft,
  buttonHover,
  buttonTap,
  errorShake,
} from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface ActiveRoom {
  code: string;
  doctorUsername: string | null;
  patientUsername: string | null;
  doctorDisplayName: string | null;
  patientDisplayName: string | null;
  doctorLang: string;
  patientLang: string;
  status: string;
}

interface RoomPreview {
  room: {
    code: string;
    doctorLang: string;
    patientLang: string;
    status: string;
    doctorUsername: string | null;
  };
  doctorProfile: DoctorProfile | null;
}

interface Props {
  user: AuthUser;
  onJoinRoom: (room: RoomInfo) => void;
  onLogout: () => void;
  onShowHistory?: () => void;
}

export default function RoomPage({ user, onJoinRoom, onLogout, onShowHistory }: Props) {
  const [roomCode, setRoomCode] = useState("");
  const [doctorLang, setDoctorLang] = useState<SupportedLang>("en");
  const [patientLang, setPatientLang] = useState<SupportedLang>("my");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [roomJoined, setRoomJoined] = useState(false);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [loadingActiveRooms, setLoadingActiveRooms] = useState(true);
  const shouldReduceMotion = useReducedMotion();

  // Room preview state (for patient join flow)
  const [roomPreview, setRoomPreview] = useState<RoomPreview | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Fetch active rooms on mount
  useEffect(() => {
    async function fetchActiveRooms() {
      try {
        const res = await fetch("/api/rooms/active/me", {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setActiveRooms(data.rooms || []);
        }
      } catch (err) {
        console.error("Failed to fetch active rooms:", err);
      } finally {
        setLoadingActiveRooms(false);
      }
    }
    fetchActiveRooms();
  }, [user.token]);

  async function handleRejoinRoom(room: ActiveRoom) {
    setLoading(true);
    setError(null);
    try {
      setRoomJoined(true);
      setTimeout(() => {
        onJoinRoom({
          code: room.code,
          doctorLang: room.doctorLang,
          patientLang: room.patientLang,
          status: room.status,
          doctorUsername: room.doctorUsername || undefined,
          patientUsername: room.patientUsername || undefined,
        });
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rejoin room");
      setLoading(false);
    }
  }

  async function handleCreateRoom() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ doctorLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create room");

      // Show success animation
      setRoomJoined(true);
      setTimeout(() => {
        onJoinRoom({
          code: data.code,
          doctorLang,
          patientLang: "", // Patient will set when joining
          status: "waiting",
          doctorUsername: user.username,
          patientUsername: undefined,
        });
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  // Step 1: Verify room exists and get doctor info
  async function handleVerifyRoom() {
    if (!roomCode.trim() || roomCode.length < 6) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/preview/${roomCode.trim()}`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Room not found");

      // Auto-select a patient language different from doctor's
      const doctorLangCode = data.room.doctorLang as SupportedLang;
      if (patientLang === doctorLangCode) {
        // Pick the first language that's not the doctor's
        const alternative = LANG_OPTIONS.find(o => o.value !== doctorLangCode);
        if (alternative) setPatientLang(alternative.value);
      }

      setRoomPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find room");
      setRoomPreview(null);
    } finally {
      setVerifying(false);
    }
  }

  // Step 2: Confirm and join the room
  async function handleConfirmJoin() {
    if (!roomPreview) return;
    // Validate language selection
    if (patientLang === roomPreview.room.doctorLang) {
      setError("Please select a different language than the doctor.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ code: roomPreview.room.code, patientLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join room");

      // Show success animation
      setRoomJoined(true);
      setTimeout(() => {
        onJoinRoom({
          code: data.room.code,
          doctorLang: data.room.doctorLang,
          patientLang: data.room.patientLang,
          status: data.room.status,
          doctorUsername: data.room.doctorUsername,
          patientUsername: user.username,
        });
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  function handleCancelPreview() {
    setRoomPreview(null);
    setRoomCode("");
    setError(null);
  }

  return (
    <div className="app">
      <motion.header
        className="app-header"
        variants={shouldReduceMotion ? {} : pageEnter}
        initial="hidden"
        animate="visible"
      >
        <div className="header-top-row">
          <motion.h1
            variants={shouldReduceMotion ? {} : fadeInUp}
            initial="hidden"
            animate="visible"
          >
            MedInterpreter
          </motion.h1>
          {onShowHistory && (
            <button
              className="btn-history"
              onClick={onShowHistory}
              title="Session History"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              History
            </button>
          )}
        </div>
        <motion.p
          className="subtitle"
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.1 }}
        >
          Signed in as <strong>{user.displayName}</strong> ({user.role})
        </motion.p>
      </motion.header>

      <main className="app-main">
        <div className="room-page">
          {/* Active Rooms Section - exclude waiting rooms with no patient (newly created) */}
          {!loadingActiveRooms && activeRooms.filter(r => r.status !== "waiting" || r.patientUsername).length > 0 && (
            <motion.div
              className="room-card active-rooms-card"
              variants={shouldReduceMotion ? {} : pageEnter}
              initial="hidden"
              animate="visible"
            >
              <motion.h2
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
              >
                Active Session
              </motion.h2>
              <motion.p
                className="room-desc"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
              >
                You have an active session. Rejoin to continue.
              </motion.p>

              {activeRooms.filter(r => r.status !== "waiting" || r.patientUsername).map((room) => (
                <div key={room.code} className="active-room-item">
                  <div className="active-room-info">
                    <div className="active-room-code">
                      <span className="label">Room Code:</span>
                      <span className="code">{room.code}</span>
                    </div>
                    <div className="active-room-participants">
                      <span className="participant doctor">
                        👨‍⚕️ {room.doctorDisplayName || room.doctorUsername || "Doctor"}
                      </span>
                      <span className="separator">↔</span>
                      <span className="participant patient">
                        🧑 {room.patientUsername
                          ? (room.patientDisplayName || room.patientUsername || "Patient")
                          : "Waiting..."}
                      </span>
                    </div>
                    <div className="active-room-langs">
                      {getLangLabel(room.doctorLang as SupportedLang)} ↔ {room.patientLang ? getLangLabel(room.patientLang as SupportedLang) : "..."}
                    </div>
                  </div>
                  <motion.button
                    className="btn-primary btn-rejoin"
                    onClick={() => handleRejoinRoom(room)}
                    disabled={loading}
                    whileHover={shouldReduceMotion || loading ? {} : buttonHover}
                    whileTap={shouldReduceMotion || loading ? {} : buttonTap}
                  >
                    {loading ? "Rejoining..." : "Rejoin Session"}
                  </motion.button>
                </div>
              ))}
            </motion.div>
          )}

          {user.role === "doctor" ? (
            <motion.div
              className="room-card"
              variants={shouldReduceMotion ? {} : pageEnter}
              initial="hidden"
              animate="visible"
            >
              <motion.h2
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
              >
                {activeRooms.length > 0 ? "Or Create New Session" : "Create a Session"}
              </motion.h2>
              <motion.p
                className="room-desc"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.1 }}
              >
                Select your language and create a room. Share the code with your patient.
              </motion.p>

              <motion.label
                className="room-lang-field room-lang-doctor"
                variants={shouldReduceMotion ? {} : slideInFromLeft}
                whileHover={shouldReduceMotion ? {} : { scale: 1.01 }}
                style={{ maxWidth: "300px", margin: "0 auto 1.5rem" }}
              >
                <span className="room-lang-label">Your language</span>
                <select
                  value={doctorLang}
                  onChange={(e) => setDoctorLang(e.target.value as SupportedLang)}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </motion.label>

              <motion.p
                className="room-hint"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                style={{ marginBottom: "1rem", opacity: 0.7, fontSize: "0.9rem" }}
              >
                Patient will select their language when they join.
              </motion.p>

              {error && (
                <motion.div
                  className="status-bar status-error"
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { ...errorShake, opacity: 1 }}
                >
                  {error}
                </motion.div>
              )}

              <motion.button
                className="btn-primary btn-large btn-with-spinner"
                onClick={handleCreateRoom}
                disabled={loading}
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                whileHover={shouldReduceMotion || loading ? {} : buttonHover}
                whileTap={shouldReduceMotion || loading ? {} : buttonTap}
              >
                {loading ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Creating...
                  </>
                ) : (
                  "Create Room"
                )}
              </motion.button>
            </motion.div>
          ) : roomPreview ? (
            /* Step 2: Room preview confirmation */
            <motion.div
              className="room-card room-preview-card"
              variants={shouldReduceMotion ? {} : pageEnter}
              initial="hidden"
              animate="visible"
            >
              <motion.h2
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
              >
                Confirm Session
              </motion.h2>
              <motion.p
                className="room-desc"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.1 }}
              >
                You are about to join a session with:
              </motion.p>

              {/* Doctor info card */}
              <motion.div
                className="doctor-preview-card"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.2 }}
              >
                <div className="doctor-preview-avatar">👨‍⚕️</div>
                <div className="doctor-preview-info">
                  <div className="doctor-preview-name">
                    {roomPreview.doctorProfile?.displayName || roomPreview.room.doctorUsername || "Doctor"}
                  </div>
                  {roomPreview.doctorProfile?.specialty && (
                    <div className="doctor-preview-specialty">
                      {roomPreview.doctorProfile.specialty}
                    </div>
                  )}
                  {roomPreview.doctorProfile?.department && (
                    <div className="doctor-preview-department">
                      {roomPreview.doctorProfile.department}
                    </div>
                  )}
                  {roomPreview.doctorProfile?.hospital && (
                    <div className="doctor-preview-hospital">
                      🏥 {roomPreview.doctorProfile.hospital}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Patient language selection */}
              <motion.div
                className="patient-lang-select"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.3 }}
              >
                <label className="room-lang-field">
                  <span className="room-lang-label">Your language</span>
                  <select
                    value={patientLang}
                    onChange={(e) => setPatientLang(e.target.value as SupportedLang)}
                  >
                    {LANG_OPTIONS.filter(o => o.value !== roomPreview.room.doctorLang).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <div className="room-preview-langs">
                  <span>{getLangLabel(roomPreview.room.doctorLang as SupportedLang)}</span>
                  <span className="lang-arrow">↔</span>
                  <span>{getLangLabel(patientLang)}</span>
                </div>
              </motion.div>

              {error && (
                <motion.div
                  className="status-bar status-error"
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { ...errorShake, opacity: 1 }}
                >
                  {error}
                </motion.div>
              )}

              {/* Action buttons */}
              <motion.div
                className="room-preview-actions"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.4 }}
              >
                <motion.button
                  className="btn-secondary btn-large"
                  onClick={handleCancelPreview}
                  disabled={loading}
                  whileHover={shouldReduceMotion || loading ? {} : buttonHover}
                  whileTap={shouldReduceMotion || loading ? {} : buttonTap}
                >
                  Cancel
                </motion.button>
                <motion.button
                  className="btn-primary btn-large btn-with-spinner"
                  onClick={handleConfirmJoin}
                  disabled={loading || patientLang === roomPreview.room.doctorLang}
                  whileHover={shouldReduceMotion || loading || patientLang === roomPreview.room.doctorLang ? {} : buttonHover}
                  whileTap={shouldReduceMotion || loading || patientLang === roomPreview.room.doctorLang ? {} : buttonTap}
                >
                  {loading ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
                      Joining...
                    </>
                  ) : (
                    "Join Session"
                  )}
                </motion.button>
              </motion.div>
            </motion.div>
          ) : (
            /* Step 1: Enter room code */
            <motion.div
              className="room-card"
              variants={shouldReduceMotion ? {} : pageEnter}
              initial="hidden"
              animate="visible"
            >
              <motion.h2
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
              >
                Join a Session
              </motion.h2>
              <motion.p
                className="room-desc"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.1 }}
              >
                Enter the room code provided by your doctor.
              </motion.p>

              <motion.label
                className="login-field"
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.2 }}
              >
                Room Code
                <motion.input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="e.g. 483291"
                  maxLength={6}
                  inputMode="numeric"
                  className="room-code-input"
                  whileFocus={shouldReduceMotion ? {} : {
                    scale: 1.02,
                    boxShadow: "var(--glow-blue)",
                  }}
                  animate={roomCode.length === 6 && !shouldReduceMotion ? {
                    scale: [1, 1.05, 1],
                  } : {}}
                  transition={{ duration: 0.3 }}
                  style={{
                    fontFamily: "var(--font-mono)",
                  }}
                />
              </motion.label>

              {error && (
                <motion.div
                  className="status-bar status-error"
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { ...errorShake, opacity: 1 }}
                >
                  {error}
                </motion.div>
              )}

              <motion.button
                className="btn-primary btn-large btn-with-spinner"
                onClick={handleVerifyRoom}
                disabled={verifying || roomCode.length < 6}
                variants={shouldReduceMotion ? {} : fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: 0.3 }}
                whileHover={shouldReduceMotion || verifying || roomCode.length < 6 ? {} : buttonHover}
                whileTap={shouldReduceMotion || verifying || roomCode.length < 6 ? {} : buttonTap}
              >
                {verifying ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Finding Room...
                  </>
                ) : (
                  "Find Room"
                )}
              </motion.button>
            </motion.div>
          )}

          <motion.button
            className="btn-link room-logout"
            onClick={onLogout}
            variants={shouldReduceMotion ? {} : fadeInUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.4 }}
            whileHover={shouldReduceMotion ? {} : { x: -4 }}
          >
            Sign out
          </motion.button>
        </div>
      </main>

      {/* Join success animation overlay */}
      {roomJoined && (
        <div className="room-success-overlay">
          <motion.div
            className="room-success-icon"
            initial={shouldReduceMotion ? {} : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            ✓
          </motion.div>
        </div>
      )}
    </div>
  );
}
