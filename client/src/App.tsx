import { useState, useCallback, useEffect } from "react";
import Disclaimer from "./components/Disclaimer";
import LoginPage from "./components/LoginPage";
import RoomPage from "./components/RoomPage";
import InterpreterView from "./components/InterpreterView";
import SummaryView from "./components/SummaryView";
import CertificateView from "./components/CertificateView";
import LegalPage from "./components/LegalPage";
import AdminDashboard from "./components/AdminDashboard";
import HistoryPage from "./components/HistoryPage";
import type { TranscriptEntry, SupportedLang, AuthUser, RoomInfo, DoctorProfile, PatientProfile, SummaryResponse, CertificateResponse } from "./types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="btn-copy"
      title={copied ? "Copied!" : "Copy room code"}
      aria-label={copied ? "Copied!" : "Copy room code"}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

type Tab = "interpret" | "summary" | "certificate";

const TABS: { id: Tab; label: string }[] = [
  { id: "interpret", label: "Interpreter" },
  { id: "summary", label: "Summary" },
  { id: "certificate", label: "Certificate" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("interpret");

  // Restore transcripts from localStorage
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>(() => {
    try {
      const saved = localStorage.getItem("medinterpreter_transcripts");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [doctorLang, setDoctorLang] = useState<SupportedLang>("en");
  const [patientLang, setPatientLang] = useState<SupportedLang>("my");
  const [legalPage, setLegalPage] = useState<"terms" | "privacy" | null>(null);

  // Load persisted state from localStorage
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("medinterpreter_dismissed") === "true";
    } catch {
      return false;
    }
  });

  // Auth & room state - restore from localStorage
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem("medinterpreter_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [room, setRoom] = useState<RoomInfo | null>(() => {
    try {
      const saved = localStorage.getItem("medinterpreter_room");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [showHistory, setShowHistory] = useState(() => {
    try {
      return localStorage.getItem("medinterpreter_view") === "history";
    } catch {
      return false;
    }
  });

  // Persist state changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("medinterpreter_dismissed", String(dismissed));
    } catch { /* ignore */ }
  }, [dismissed]);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem("medinterpreter_user", JSON.stringify(user));
      } else {
        localStorage.removeItem("medinterpreter_user");
        localStorage.removeItem("medinterpreter_room");
        localStorage.removeItem("medinterpreter_view");
        localStorage.removeItem("medinterpreter_transcripts");
      }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => {
    try {
      if (room) {
        localStorage.setItem("medinterpreter_room", JSON.stringify(room));
      } else {
        localStorage.removeItem("medinterpreter_room");
        localStorage.removeItem("medinterpreter_transcripts");
      }
    } catch { /* ignore */ }
  }, [room]);

  // Persist transcripts to localStorage
  useEffect(() => {
    try {
      if (transcripts.length > 0) {
        localStorage.setItem("medinterpreter_transcripts", JSON.stringify(transcripts));
      }
    } catch { /* ignore */ }
  }, [transcripts]);

  useEffect(() => {
    try {
      localStorage.setItem("medinterpreter_view", showHistory ? "history" : "room");
    } catch { /* ignore */ }
  }, [showHistory]);

  // Track if session was validated to avoid repeated calls
  const [sessionValidated, setSessionValidated] = useState(false);

  // Validate token and restore room data on mount
  useEffect(() => {
    if (sessionValidated) return;
    if (!user?.token) return;

    async function validateSession() {
      try {
        // Validate token by calling /api/auth/me
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${user!.token}` },
        });

        if (!res.ok) {
          // Token invalid, clear session
          console.log("Session expired, logging out");
          setUser(null);
          setRoom(null);
          setShowHistory(false);
          return;
        }

        setSessionValidated(true);

        // Token valid - restore room data if we have a room
        if (room) {
          // Load fresh room data, transcripts, and participant profile
          try {
            console.log("Fetching data for room:", room.code);

            // Refresh room data (including status) from server
            const roomRes = await fetch(`/api/rooms/${room.code}`, {
              headers: { Authorization: `Bearer ${user!.token}` },
            });
            if (roomRes.ok) {
              const data = await roomRes.json();
              if (data.room) {
                console.log("Refreshed room status:", data.room.status);
                setRoom(data.room);
                setDoctorLang(data.room.doctorLang as SupportedLang);
                if (data.room.patientLang) {
                  setPatientLang(data.room.patientLang as SupportedLang);
                }
              }
            } else {
              // Room not found or access denied - clear room
              console.log("Room no longer accessible, clearing");
              setRoom(null);
              return;
            }

            // Load transcripts
            const transcriptsRes = await fetch(`/api/rooms/${room.code}/transcripts`, {
              headers: { Authorization: `Bearer ${user!.token}` },
            });
            if (transcriptsRes.ok) {
              const data = await transcriptsRes.json();
              console.log("Loaded transcripts:", data.transcripts?.length || 0);
              setTranscripts(data.transcripts || []);
            }

            // Load participant profile
            const profileRes = await fetch(`/api/rooms/${room.code}/participant-profile`, {
              headers: { Authorization: `Bearer ${user!.token}` },
            });
            if (profileRes.ok) {
              const data = await profileRes.json();
              console.log("Loaded participant profile:", data.profile?.displayName);
              if (data.profile) {
                setParticipantProfile(data.profile);
              }
            }

            // Load saved summary
            try {
              const summaryRes = await fetch(`/api/rooms/${room.code}/summary`, {
                headers: { Authorization: `Bearer ${user!.token}` },
              });
              console.log("Summary API response status:", summaryRes.status);
              if (summaryRes.ok) {
                const data = await summaryRes.json();
                console.log("Summary API data:", data);
                if (data.summary) {
                  console.log("Loaded saved summary");
                  setCachedSummary({
                    summaryLang1: data.summary.summaryLang1,
                    summaryLang2: data.summary.summaryLang2,
                    lang1Label: data.summary.lang1Label,
                    lang2Label: data.summary.lang2Label,
                  });
                } else {
                  console.log("No summary data in response");
                }
              } else {
                console.log("Summary API failed:", summaryRes.status);
              }
            } catch (summaryErr) {
              console.error("Failed to load summary:", summaryErr);
            }

            // Load saved certificate
            try {
              const certRes = await fetch(`/api/rooms/${room.code}/certificate`, {
                headers: { Authorization: `Bearer ${user!.token}` },
              });
              console.log("Certificate API response status:", certRes.status);
              if (certRes.ok) {
                const data = await certRes.json();
                console.log("Certificate API data:", data);
                if (data.certificate) {
                  console.log("Loaded saved certificate");
                  setCachedCertificate({
                    certificateLang1: data.certificate.certificateLang1,
                    certificateLang2: data.certificate.certificateLang2,
                    lang1Label: data.certificate.lang1Label,
                    lang2Label: data.certificate.lang2Label,
                  });
                } else {
                  console.log("No certificate data in response");
                }
              } else {
                console.log("Certificate API failed:", certRes.status);
              }
            } catch (certErr) {
              console.error("Failed to load certificate:", certErr);
            }
          } catch (err) {
            console.error("Failed to load room data:", err);
          }
        }
      } catch {
        // Network error - keep session but don't validate
        console.log("Could not validate session, keeping local state");
      }
    }

    validateSession();
  }, [user, room, sessionValidated]);

  const [peerConnected, setPeerConnected] = useState(false);
  const [participantProfile, setParticipantProfile] = useState<DoctorProfile | PatientProfile | null>(null);
  const [myProfile, setMyProfile] = useState<DoctorProfile | PatientProfile | null>(null);
  const [showProfilePanel, setShowProfilePanel] = useState<"doctor" | "patient" | false>(false);
  const [peerActivity, setPeerActivity] = useState<"idle" | "typing" | "speaking" | "processing" | "analyzing_image">("idle");

  // Cached summary and certificate from Complete flow
  const [cachedSummary, setCachedSummary] = useState<SummaryResponse | null>(null);
  const [cachedCertificate, setCachedCertificate] = useState<CertificateResponse | null>(null);

  if (legalPage) {
    return <LegalPage page={legalPage} onBack={() => setLegalPage(null)} />;
  }

  if (!dismissed) {
    return <Disclaimer onDismiss={() => setDismissed(true)} />;
  }

  // Auth gate
  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  // Admin route - show dashboard instead of room flow
  if (user.role === "admin") {
    return <AdminDashboard user={user} onLogout={() => setUser(null)} />;
  }

  // Load a session from history (called when clicking on a history card)
  async function loadHistorySession(roomCode: string) {
    if (!user?.token) return;

    try {
      // Load room data
      const roomRes = await fetch(`/api/rooms/${roomCode}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!roomRes.ok) {
        console.error("Failed to load room:", roomRes.status);
        return;
      }
      const roomData = await roomRes.json();
      if (!roomData.room) {
        console.error("Room not found");
        return;
      }

      // Set room and languages
      setRoom(roomData.room);
      setDoctorLang(roomData.room.doctorLang as SupportedLang);
      if (roomData.room.patientLang) {
        setPatientLang(roomData.room.patientLang as SupportedLang);
      }

      // Load transcripts
      try {
        const transcriptsRes = await fetch(`/api/rooms/${roomCode}/transcripts`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (transcriptsRes.ok) {
          const data = await transcriptsRes.json();
          setTranscripts(data.transcripts || []);
        }
      } catch (err) {
        console.error("Failed to load transcripts:", err);
      }

      // Load participant profile
      try {
        const profileRes = await fetch(`/api/rooms/${roomCode}/participant-profile`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (profileRes.ok) {
          const data = await profileRes.json();
          if (data.profile) {
            setParticipantProfile(data.profile);
          }
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      }

      // Load saved summary
      try {
        const summaryRes = await fetch(`/api/rooms/${roomCode}/summary`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (summaryRes.ok) {
          const data = await summaryRes.json();
          if (data.summary) {
            setCachedSummary({
              summaryLang1: data.summary.summaryLang1,
              summaryLang2: data.summary.summaryLang2,
              lang1Label: data.summary.lang1Label,
              lang2Label: data.summary.lang2Label,
            });
          }
        }
      } catch (err) {
        console.error("Failed to load summary:", err);
      }

      // Load saved certificate
      try {
        const certRes = await fetch(`/api/rooms/${roomCode}/certificate`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (certRes.ok) {
          const data = await certRes.json();
          if (data.certificate) {
            setCachedCertificate({
              certificateLang1: data.certificate.certificateLang1,
              certificateLang2: data.certificate.certificateLang2,
              lang1Label: data.certificate.lang1Label,
              lang2Label: data.certificate.lang2Label,
            });
          }
        }
      } catch (err) {
        console.error("Failed to load certificate:", err);
      }

      // Exit history view and show the room
      setShowHistory(false);
      // For completed sessions, go to summary tab
      if (roomData.room.status === "completed" || roomData.room.status === "closed") {
        setTab("summary");
      }
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }

  // History page
  if (showHistory) {
    return (
      <HistoryPage
        user={user}
        onBack={() => setShowHistory(false)}
        onViewSession={(roomCode) => {
          loadHistorySession(roomCode);
        }}
      />
    );
  }

  // Load transcripts for a room
  async function loadTranscripts(roomCode: string, token: string) {
    try {
      const res = await fetch(`/api/rooms/${roomCode}/transcripts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.transcripts && data.transcripts.length > 0) {
          setTranscripts(data.transcripts);
        }
      }
    } catch (err) {
      console.error("Failed to load transcripts:", err);
    }
  }

  // Load participant profile for a room (the OTHER participant)
  async function loadParticipantProfile(roomCode: string, token: string) {
    try {
      const res = await fetch(`/api/rooms/${roomCode}/participant-profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setParticipantProfile(data.profile);
        }
      }
    } catch (err) {
      console.error("Failed to load participant profile:", err);
    }
  }

  // Load the current user's own profile
  async function loadMyProfile(token: string) {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setMyProfile(data.profile);
        }
      }
    } catch (err) {
      console.error("Failed to load my profile:", err);
    }
  }

  // Load saved summary for a room
  async function loadSavedSummary(roomCode: string, token: string) {
    try {
      const res = await fetch(`/api/rooms/${roomCode}/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          console.log("Loaded saved summary");
          setCachedSummary({
            summaryLang1: data.summary.summaryLang1,
            summaryLang2: data.summary.summaryLang2,
            lang1Label: data.summary.lang1Label,
            lang2Label: data.summary.lang2Label,
          });
        }
      }
    } catch (err) {
      console.error("Failed to load saved summary:", err);
    }
  }

  // Load saved certificate for a room
  async function loadSavedCertificate(roomCode: string, token: string) {
    try {
      const res = await fetch(`/api/rooms/${roomCode}/certificate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.certificate) {
          console.log("Loaded saved certificate");
          setCachedCertificate({
            certificateLang1: data.certificate.certificateLang1,
            certificateLang2: data.certificate.certificateLang2,
            lang1Label: data.certificate.lang1Label,
            lang2Label: data.certificate.lang2Label,
          });
        }
      }
    } catch (err) {
      console.error("Failed to load saved certificate:", err);
    }
  }

  // Refresh room data (e.g., when patient joins and sets language)
  async function refreshRoomData(roomCode: string, token: string) {
    try {
      const res = await fetch(`/api/rooms/${roomCode}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room) {
          setRoom(data.room);
          setDoctorLang(data.room.doctorLang as SupportedLang);
          if (data.room.patientLang) {
            setPatientLang(data.room.patientLang as SupportedLang);
          }
        }
      }
    } catch (err) {
      console.error("Failed to refresh room data:", err);
    }
  }

  // Room gate
  if (!room) {
    return (
      <RoomPage
        user={user}
        onJoinRoom={async (r) => {
          // Clear old session data first before setting new room
          setTranscripts([]);
          setCachedSummary(null);
          setCachedCertificate(null);
          setParticipantProfile(null);
          setPeerConnected(false);
          setTab("interpret"); // Reset to interpreter tab for new room

          setRoom(r);
          setDoctorLang(r.doctorLang as SupportedLang);
          setPatientLang(r.patientLang as SupportedLang);
          // If room is already active (has both participants), mark peer as connected
          if (r.status === "active" && r.doctorUsername && r.patientUsername) {
            setPeerConnected(true);
          }
          // Load saved transcripts, participant profile, my own profile, and saved summary/certificate
          await Promise.all([
            loadTranscripts(r.code, user.token),
            loadParticipantProfile(r.code, user.token),
            loadMyProfile(user.token),
            loadSavedSummary(r.code, user.token),
            loadSavedCertificate(r.code, user.token),
          ]);
        }}
        onLogout={() => setUser(null)}
        onShowHistory={() => setShowHistory(true)}
      />
    );
  }

  function handleLeaveRoom() {
    setRoom(null);
    setTranscripts([]);
    setPeerConnected(false);
    setParticipantProfile(null);
    setMyProfile(null);
    setCachedSummary(null);
    setCachedCertificate(null);
  }

  // Show tabs based on role and content availability
  // Doctors see all tabs; Patients see Interpreter + Summary/Certificate if they exist
  const visibleTabs = user.role === "doctor"
    ? TABS
    : TABS.filter((t) => {
        if (t.id === "interpret") return true;
        if (t.id === "summary" && cachedSummary) return true;
        if (t.id === "certificate" && cachedCertificate) return true;
        return false;
      });

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top-row">
          <h1 className="app-brand" onClick={handleLeaveRoom} title="Leave room">
            MedInterpreter
          </h1>
          <div className="header-actions">
            <button
              className="btn-history"
              onClick={() => setShowHistory(true)}
              title="Session History"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              History
            </button>
            <button
              className="btn-signout"
              onClick={() => {
                setRoom(null);
                setUser(null);
                setTranscripts([]);
                setPeerConnected(false);
                setParticipantProfile(null);
                setMyProfile(null);
                setShowProfilePanel(false);
              }}
              title="Sign Out"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Room Code Display - Prominent for sharing */}
        <div className="room-header-info">
          <div className="room-code-badge">
            <span className="room-code-label">Share Code:</span>
            <span className="room-code-value">{room.code}</span>
            <CopyButton text={room.code} />
          </div>
          <div className="room-status">
            <span className={`status-dot ${peerConnected ? 'connected' : 'waiting'}`} />
            {peerConnected ? "Partner connected" : "Waiting for partner..."}
          </div>
        </div>

        {/* Participants Info */}
        <div className="room-participants">
          <div className="participant doctor-participant">
            <span className="participant-icon">👨‍⚕️</span>
            <span className={`activity-dot ${user.role === 'doctor' ? 'active' : (peerConnected ? 'active' : 'offline')}`} />
            <span className="participant-name">
              {user.role === 'doctor'
                ? user.displayName
                : (participantProfile && 'specialty' in participantProfile
                    ? participantProfile.displayName
                    : room.doctorUsername || 'Doctor')}
            </span>
            {user.role === 'patient' && participantProfile && 'specialty' in participantProfile && (
              <span className="participant-detail">{participantProfile.specialty}</span>
            )}
            <button
              className="participant-view-icon"
              onClick={() => setShowProfilePanel(showProfilePanel === 'doctor' ? false : 'doctor' as any)}
              title="View doctor info"
              aria-label="View doctor info"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <span className="participant-separator">↔</span>
          <div className="participant patient-participant">
            <span className="participant-icon">🧑</span>
            <span className={`activity-dot ${user.role === 'patient' ? 'active' : (peerConnected ? 'active' : 'offline')}`} />
            <span className="participant-name">
              {user.role === 'patient'
                ? user.displayName
                : (participantProfile && 'bloodType' in participantProfile
                    ? participantProfile.displayName
                    : room.patientUsername || 'Patient')}
            </span>
            {user.role === 'doctor' && participantProfile && 'bloodType' in participantProfile && participantProfile.allergies && participantProfile.allergies.length > 0 && (
              <span className="participant-alert">⚠️ Allergies</span>
            )}
            <button
              className="participant-view-icon"
              onClick={() => setShowProfilePanel(showProfilePanel === 'patient' ? false : 'patient' as any)}
              title="View patient info"
              aria-label="View patient info"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </div>

        {/* Profile Info Panel */}
        {showProfilePanel && (
          <div className="profile-panel">
            <button className="profile-panel-close" onClick={() => setShowProfilePanel(false)}>×</button>
            {showProfilePanel === 'doctor' ? (
              // Doctor profile - show myProfile if viewing own, participantProfile if viewing other
              (() => {
                const isViewingOwnProfile = user.role === 'doctor';
                const doctorData = isViewingOwnProfile
                  ? (myProfile && 'specialty' in myProfile ? myProfile as DoctorProfile : null)
                  : (participantProfile && 'specialty' in participantProfile ? participantProfile as DoctorProfile : null);
                const doctorName = isViewingOwnProfile
                  ? user.displayName
                  : (doctorData?.displayName || room.doctorUsername);

                return (
                  <div className="profile-content">
                    <h3>Doctor Information {isViewingOwnProfile && <span className="profile-you-badge">(You)</span>}</h3>
                    <div className="profile-field">
                      <label>Name</label>
                      <span>{doctorName}</span>
                    </div>
                    {(isViewingOwnProfile ? user.specialty : doctorData?.specialty) && (
                      <div className="profile-field">
                        <label>Specialty</label>
                        <span>{isViewingOwnProfile ? user.specialty : doctorData?.specialty}</span>
                      </div>
                    )}
                    {(isViewingOwnProfile ? user.hospital : doctorData?.hospital) && (
                      <div className="profile-field">
                        <label>Hospital</label>
                        <span>{isViewingOwnProfile ? user.hospital : doctorData?.hospital}</span>
                      </div>
                    )}
                    {(isViewingOwnProfile ? user.department : doctorData?.department) && (
                      <div className="profile-field">
                        <label>Department</label>
                        <span>{isViewingOwnProfile ? user.department : doctorData?.department}</span>
                      </div>
                    )}
                    {(isViewingOwnProfile ? user.licenseNumber : doctorData?.licenseNumber) && (
                      <div className="profile-field">
                        <label>License</label>
                        <span>{isViewingOwnProfile ? user.licenseNumber : doctorData?.licenseNumber}</span>
                      </div>
                    )}
                    {!isViewingOwnProfile && !doctorData && (
                      <p className="profile-note">Doctor profile not available.</p>
                    )}
                  </div>
                );
              })()
            ) : (
              // Patient profile - show myProfile if viewing own, participantProfile if viewing other
              (() => {
                const isViewingOwnProfile = user.role === 'patient';
                const patientData = isViewingOwnProfile
                  ? (myProfile && 'bloodType' in myProfile ? myProfile as PatientProfile : null)
                  : (participantProfile && 'bloodType' in participantProfile ? participantProfile as PatientProfile : null);
                const patientName = isViewingOwnProfile
                  ? user.displayName
                  : (patientData?.displayName || room.patientUsername);

                return (
                  <div className="profile-content">
                    <h3>Patient Information {isViewingOwnProfile && <span className="profile-you-badge">(You)</span>}</h3>
                    <div className="profile-field">
                      <label>Name</label>
                      <span>{patientName}</span>
                    </div>
                    {patientData && (
                      <>
                        {patientData.dateOfBirth && (
                          <div className="profile-field">
                            <label>Date of Birth</label>
                            <span>{patientData.dateOfBirth}</span>
                          </div>
                        )}
                        {patientData.bloodType && (
                          <div className="profile-field">
                            <label>Blood Type</label>
                            <span>{patientData.bloodType}</span>
                          </div>
                        )}
                        {(patientData.height || patientData.weight) && (
                          <div className="profile-field">
                            <label>Height / Weight</label>
                            <span>{[patientData.height, patientData.weight].filter(Boolean).join(' / ')}</span>
                          </div>
                        )}
                        {patientData.bloodPressure && (
                          <div className="profile-field">
                            <label>Blood Pressure</label>
                            <span>{patientData.bloodPressure}</span>
                          </div>
                        )}
                        {patientData.allergies && patientData.allergies.length > 0 && (
                          <div className="profile-field alert">
                            <label>Allergies</label>
                            <span>{patientData.allergies.join(', ')}</span>
                          </div>
                        )}
                        {patientData.currentMedications && patientData.currentMedications.length > 0 && (
                          <div className="profile-field">
                            <label>Current Medications</label>
                            <span>{patientData.currentMedications.join(', ')}</span>
                          </div>
                        )}
                        {patientData.medicalConditions && patientData.medicalConditions.length > 0 && (
                          <div className="profile-field">
                            <label>Medical Conditions</label>
                            <span>{patientData.medicalConditions.join(', ')}</span>
                          </div>
                        )}
                        {patientData.emergencyContact && (
                          <div className="profile-field">
                            <label>Emergency Contact</label>
                            <span>{patientData.emergencyContact}</span>
                          </div>
                        )}
                      </>
                    )}
                    {isViewingOwnProfile && !patientData && (
                      <p className="profile-note">Your profile information is not available.</p>
                    )}
                    {!isViewingOwnProfile && !patientData && (
                      <p className="profile-note">Patient profile not available yet.</p>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {visibleTabs.length > 1 && (
          <>
            {/* Desktop tabs */}
            <nav className="tabs" role="tablist" aria-label="Main navigation">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`tabpanel-${t.id}`}
                  className={tab === t.id ? "active" : ""}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {/* Mobile dropdown */}
            <div className="tab-select-mobile">
              <select
                value={tab}
                onChange={(e) => setTab(e.target.value as Tab)}
                aria-label="Select view"
              >
                {visibleTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </header>

      <main className="app-main">
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-label={visibleTabs.find(t => t.id === tab)?.label}>
          {tab === "interpret" && (
            <InterpreterView
              transcripts={transcripts}
              setTranscripts={setTranscripts}
              doctorLang={doctorLang}
              patientLang={patientLang}
              setDoctorLang={setDoctorLang}
              setPatientLang={setPatientLang}
              user={user}
              room={room}
              participantProfile={participantProfile}
              cachedCertificate={cachedCertificate}
              onPeerConnected={() => {
                setPeerConnected(true);
                // Refresh room data to get updated patientLang when patient joins
                refreshRoomData(room.code, user.token);
              }}
              onPeerDisconnected={() => setPeerConnected(false)}
              onPeerActivity={setPeerActivity}
              onProfileRefresh={() => loadParticipantProfile(room.code, user.token)}
              onSummaryGenerated={setCachedSummary}
              onCertificateGenerated={setCachedCertificate}
            />
          )}
          {tab === "summary" && (
            <SummaryView
              transcripts={transcripts}
              doctorLang={doctorLang}
              patientLang={patientLang}
              cachedSummary={cachedSummary}
              onSummaryGenerated={setCachedSummary}
              room={room}
              user={user}
            />
          )}
          {tab === "certificate" && (
            <CertificateView
              transcripts={transcripts}
              doctorLang={doctorLang}
              patientLang={patientLang}
              user={user}
              participantProfile={participantProfile}
              roomCreatedAt={room?.createdAt}
              cachedCertificate={cachedCertificate}
              onCertificateGenerated={setCachedCertificate}
              room={room}
            />
          )}
        </div>
      </main>

    </div>
  );
}
