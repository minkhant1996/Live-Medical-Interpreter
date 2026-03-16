import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAudioStreamer } from "../hooks/useAudioStreamer";
import { useWebSocket } from "../hooks/useWebSocket";
import type { TranscriptEntry, WSServerMessage, SupportedLang, AuthUser, RoomInfo, ImageAnalysisResult, StreamStatus, ConversationSummaryData, SharedCertificateData, DoctorProfile, PatientProfile } from "../types";
import { LANG_OPTIONS, getLangLabel } from "../types";
import SessionCompleteModal from "./SessionCompleteModal";
import CertificateViewerModal from "./CertificateViewerModal";
import { fadeInUp, typingDot, iconButtonHover, iconButtonTap, sendButtonFlyAway } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

// --- Audio message entry ---
interface AudioMessageEntry {
  id: string;
  role: "doctor" | "patient";
  audioBase64: string;
  mimeType: string;
  timestamp: number;
}

// --- Unified timeline item ---
type TimelineItem =
  | { kind: "transcript"; data: TranscriptEntry }
  | { kind: "image"; data: ImageAnalysisEntry };

interface ImageAnalysisEntry {
  id: string;
  senderRole: "doctor" | "patient";
  imagePreview: string;
  result: ImageAnalysisResult;
  timestamp: number;
}

type PeerActivity = "typing" | "speaking" | "processing" | "analyzing_image" | "idle" | null;

interface Props {
  transcripts: TranscriptEntry[];
  setTranscripts: React.Dispatch<React.SetStateAction<TranscriptEntry[]>>;
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  setDoctorLang: (lang: SupportedLang) => void;
  setPatientLang: (lang: SupportedLang) => void;
  user: AuthUser;
  room: RoomInfo;
  participantProfile?: DoctorProfile | PatientProfile | null;
  cachedCertificate?: import("../types").CertificateResponse | null;
  onPeerConnected: () => void;
  onPeerDisconnected: () => void;
  onPeerActivity?: (activity: "idle" | "typing" | "speaking" | "processing" | "analyzing_image") => void;
  onProfileRefresh?: () => void;
  onSummaryGenerated?: (summary: import("../types").SummaryResponse) => void;
  onCertificateGenerated?: (cert: import("../types").CertificateResponse) => void;
}

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp,image/tiff,image/avif";

export default function InterpreterView({
  transcripts,
  setTranscripts,
  doctorLang,
  patientLang,
  setDoctorLang,
  setPatientLang,
  user,
  room,
  participantProfile,
  cachedCertificate,
  onPeerConnected,
  onPeerDisconnected,
  onPeerActivity,
  onProfileRefresh,
  onSummaryGenerated,
  onCertificateGenerated: onCertificateGeneratedProp,
}: Props) {
  // Admins are blocked from joining rooms at the WebSocket level,
  // so myRole will only ever be "doctor" | "patient" here
  const myRole = user.role as "doctor" | "patient";
  const shouldReduceMotion = useReducedMotion();
  const otherLabel = myRole === "doctor" ? "Patient" : "Doctor";
  const myLang = myRole === "doctor" ? doctorLang : patientLang;
  const peerLang = myRole === "doctor" ? patientLang : doctorLang;

  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTranslation, setLiveTranslation] = useState("");
  const [liveTranslationRole, setLiveTranslationRole] = useState<"doctor" | "patient" | null>(null);
  // Stream status for real-time feedback
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  // Timer for showing duration of current status
  const [statusStartTime, setStatusStartTime] = useState<number>(0);
  const [statusDuration, setStatusDuration] = useState<number>(0);
  const [myText, setMyText] = useState("");
  const [myProcessing, setMyProcessing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  // Post-conversation processing
  const [isProcessingSummary, setIsProcessingSummary] = useState(false);
  // Session completed - permanently locks chat after doctor ends session
  // Initialize based on existing certificate or room status
  const [isSessionCompleted, setIsSessionCompleted] = useState(
    () => !!cachedCertificate || room.status === "closed"
  );
  const [conversationSummary, setConversationSummary] = useState<ConversationSummaryData | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Shared certificate (received via WebSocket)
  const [sharedCertificate, setSharedCertificate] = useState<SharedCertificateData | null>(null);
  const [showCertificateViewer, setShowCertificateViewer] = useState(false);

  // Currently playing audio ID (for play/pause toggle)
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // Image analysis
  const [imageAnalyses, setImageAnalyses] = useState<ImageAnalysisEntry[]>([]);

  const [imageUploading, setImageUploading] = useState(false);
  const [imageDescription, setImageDescription] = useState("");
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Fullscreen lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Peer activity
  const [peerActivity, setPeerActivity] = useState<PeerActivity>(null);
  const peerActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Typing detection — send peer_activity to other side
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasTypingRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);


  const handleMessage = useCallback(
    (msg: WSServerMessage) => {
      switch (msg.type) {
        case "stream_started":
          break;
        case "translation_delta":
          setLiveTranslation((prev) => prev + msg.text);
          break;
        case "translation_started":
          // Someone started translating — show the role that's being translated
          if (msg.role !== myRole) {
            setLiveTranslationRole(msg.role);
            setLiveTranslation("");
          }
          break;
        case "transcript": {
          // Store transcript WITH inline audio (combined message)
          const entryWithAudio: TranscriptEntry = {
            ...msg.entry,
            audioBase64: msg.audioBase64,
            audioMimeType: msg.audioMimeType,
          };
          console.log("[Transcript] Received:", { id: msg.entry.id, role: msg.entry.role, hasAudio: !!msg.audioBase64 });
          setTranscripts((prev) => [...prev, entryWithAudio]);
          setLiveTranslation("");
          setLiveTranslationRole(null);
          if (msg.entry.role === myRole) setMyProcessing(false);
          // Clear peer activity when their message arrives
          if (msg.entry.role !== myRole) {
            setPeerActivity(null);
          }
          break;
        }
        case "audio_chunk":
          console.log("[Audio] Received audio_chunk from server, size:", msg.audio?.length, "mime:", msg.mimeType);
          playPcmAudioRef.current(msg.audio, msg.mimeType);
          break;
        case "audio_response":
          playAudioResponseRef.current(msg.audio, msg.mimeType);
          break;
        case "interrupted":
          // Don't clear playback - let the translation audio finish playing
          // even if sender starts speaking again
          setLiveTranslation("");
          break;
        case "stream_ended":
          setIsRecording(false);
          setStreamStatus("idle");
          // Don't clear liveTranslation here - let it clear when transcript arrives
          break;
        case "stream_status":
          setStreamStatus(msg.status);
          setStatusStartTime(Date.now());
          setStatusDuration(0);
          break;
        case "transcription_interim":
          // Ignore interim transcriptions - only show final audio messages
          break;
        case "transcription_final":
          // Ignore - we use the combined transcript message with audio instead
          break;
        case "processing_summary":
          setIsProcessingSummary(true);
          break;
        case "conversation_summary":
          setIsProcessingSummary(false);
          setShowCompleteConfirm(false);
          if (msg.summary) {
            setConversationSummary(msg.summary);
            // Add transcribed segments to conversation
            for (const seg of msg.summary.segments) {
              setTranscripts((prev) => [...prev, {
                id: `summary-${seg.timestamp}`,
                role: seg.role,
                original: seg.original,
                translated: seg.translated,
                originalLang: seg.originalLang,
                translatedLang: seg.translatedLang,
                timestamp: seg.timestamp,
              }]);
            }
            setShowSummaryModal(true);
          } else {
            // No audio to process - show message or go directly to certificate
            const noAudioMsg = msg.message || "No audio recorded. You can still generate a certificate from the text conversation.";
            if (transcripts.length > 0) {
              // If there are text transcripts, show the complete modal directly
              setShowCompleteModal(true);
            } else {
              setError(noAudioMsg);
            }
          }
          break;
        // audio_message is no longer sent separately - audio is included in transcript
        case "peer_connected":
          onPeerConnected();
          // Clear any connection-related errors when peer connects
          setError(null);
          // Refresh participant profile when peer connects
          onProfileRefresh?.();
          break;
        case "peer_disconnected":
          onPeerDisconnected();
          setPeerActivity(null);
          onPeerActivity?.("idle");
          break;
        case "peer_activity":
          if (msg.activity === "idle") {
            setPeerActivity(null);
            onPeerActivity?.("idle");
          } else {
            setPeerActivity(msg.activity);
            onPeerActivity?.(msg.activity);
            // Auto-clear after 10s in case we miss an "idle"
            if (peerActivityTimeoutRef.current) clearTimeout(peerActivityTimeoutRef.current);
            peerActivityTimeoutRef.current = setTimeout(() => {
              setPeerActivity(null);
              onPeerActivity?.("idle");
            }, 10000);
          }
          break;
        case "image_analysis_result":
          setImageAnalyses((prev) => {
            const next = [
              ...prev,
              {
                id: crypto.randomUUID(),
                senderRole: msg.senderRole,
                imagePreview: msg.imagePreview,
                result: msg.result,
                timestamp: Date.now(),
              },
            ];
            // Cap at 20 to prevent unbounded memory growth from base64 images
            return next.length > 20 ? next.slice(-20) : next;
          });
          setImageUploading(false);
          setPeerActivity(null);
          break;
        case "certificate_shared":
          // Received certificate from doctor - show viewer
          if (msg.certificate) {
            setSharedCertificate(msg.certificate);
            setShowCertificateViewer(true);
            setShowSummaryModal(false);
            setShowCompleteModal(false);
          }
          break;
        case "peer_language_update":
          // Patient changed their language - update our state
          console.log("[WS] Peer language update:", msg.patientLang);
          setPatientLang(msg.patientLang as SupportedLang);
          break;
        case "error":
          setError(msg.message);
          setIsRecording(false);
          setLiveTranslation("");
          setLiveTranslationRole(null);
          setMyProcessing(false);
          setImageUploading(false);
          break;
      }
    },
    [setTranscripts, myRole, onPeerConnected, onPeerDisconnected, setPatientLang]
  );

  const { connected, reconnecting, connect, send, resetReconnect } = useWebSocket(handleMessage, {
    token: user.token,
    roomCode: room.code,
  });

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnected.current) {
      // Clear connection-related errors on reconnect
      setError(null);
      setMyProcessing(false);
      setIsRecording(false);
      setLiveTranslation("");
      setLiveTranslationRole(null);
      setPeerActivity(null);
    }
    prevConnected.current = connected;
  }, [connected]);

  // Send typing indicators
  function notifyTyping() {
    if (!wasTypingRef.current) {
      wasTypingRef.current = true;
      send({ type: "peer_activity", activity: "typing" });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      wasTypingRef.current = false;
      send({ type: "peer_activity", activity: "idle" });
    }, 2000);
  }

  const onSpeechStart = useCallback(() => {
    console.log("[Speech] Started");
    send({ type: "speech_start" });
  }, [send]);

  // Stream audio chunks in real-time while speaking
  const onAudioChunk = useCallback((audioBase64: string) => {
    send({ type: "audio_chunk", audio: audioBase64 });
  }, [send]);

  // Signal turn complete (audio already streamed)
  const onSpeechEnd = useCallback(() => {
    console.log("[Speech] Ended - signaling turn complete");
    send({ type: "speech_end", audio: "" });  // Empty audio - already streamed
  }, [send]);

  const {
    isStreaming,
    startStreaming,
    stopStreaming,
    playAudioResponse,
    playPcmAudio,
    clearPlaybackQueue,
  } = useAudioStreamer({ onSpeechStart, onAudioChunk, onSpeechEnd });

  const playPcmAudioRef = useRef(playAudioResponse);
  const playAudioResponseRef = useRef(playAudioResponse);
  const clearPlaybackQueueRef = useRef(clearPlaybackQueue);
  playPcmAudioRef.current = playPcmAudio;
  playAudioResponseRef.current = playAudioResponse;
  clearPlaybackQueueRef.current = clearPlaybackQueue;

  useEffect(() => {
    connect();
  }, [connect]);

  // Build unified timeline sorted by timestamp
  // Attach matching audio to transcripts so both text and audio can be shown
  // Build timeline from transcripts (audio is now included in each transcript)
  const timeline: TimelineItem[] = [];
  for (const t of transcripts) {
    // Audio is now directly on the transcript (no matching needed)
    timeline.push({ kind: "transcript", data: t });
  }
  for (const ia of imageAnalyses) {
    timeline.push({ kind: "image", data: ia });
  }
  timeline.sort((a, b) => a.data.timestamp - b.data.timestamp);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, imageAnalyses]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxSrc) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxSrc(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  // Update status duration timer
  useEffect(() => {
    if (!isRecording || !statusStartTime) return;
    const interval = setInterval(() => {
      setStatusDuration(Math.floor((Date.now() - statusStartTime) / 100) / 10);
    }, 100);
    return () => clearInterval(interval);
  }, [isRecording, statusStartTime]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (peerActivityTimeoutRef.current) clearTimeout(peerActivityTimeoutRef.current);
    };
  }, []);

  // Stop recording when page becomes hidden (user switches apps on mobile)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && isRecording) {
        console.log("[Mic] Page hidden, stopping recording");
        stopStreaming();
        send({ type: "stop_stream" });
        setIsRecording(false);
        setStreamStatus("idle");
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isRecording, stopStreaming, send]);

  // Cleanup on unmount - ensure mic is stopped
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  // Audio messages are not persisted - only valid for current session

  const langsValid = doctorLang && patientLang && doctorLang !== patientLang;

  // Track when recording started to prevent accidental immediate stop
  const recordingStartTimeRef = useRef<number>(0);

  // Start recording (mic button - only starts, doesn't stop)
  async function handleStartRecording() {
    if (!langsValid || isRecording) return;

    recordingStartTimeRef.current = Date.now();
    setIsRecording(true);
    setError(null);

    try {
      await startStreaming();
      send({ type: "start_stream", role: myRole, doctorLang, patientLang, gender: user.gender || "male" });
    } catch (err) {
      const msg = err instanceof Error && err.name === "NotAllowedError"
        ? "Microphone access denied."
        : "Failed to start audio. Please check your microphone.";
      setError(msg);
      setIsRecording(false);
    }
  }

  // Stop recording (separate stop button)
  function handleStopRecording() {
    // Prevent accidental stop if clicked within 500ms of starting
    if (Date.now() - recordingStartTimeRef.current < 500) return;

    // Always stop streaming when called (even if isRecording is already false)
    // This ensures cleanup happens on mobile where state updates may lag
    stopStreaming();

    // Only send stop_stream if we were recording
    if (isRecording) {
      send({ type: "stop_stream" });
    }

    setIsRecording(false);
    setStreamStatus("idle");
    // Don't clear liveTranslation - let ongoing translation complete
  }

  function handleTextSend() {
    if (!myText.trim() || myProcessing || !langsValid) return;

    setError(null);
    setMyProcessing(true);
    const text = myText.trim();
    setMyText("");

    // Clear typing indicator
    wasTypingRef.current = false;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    send({ type: "peer_activity", activity: "idle" });

    send({
      type: "text_message",
      role: myRole,
      text,
      doctorLang,
      patientLang,
    });
  }

  function handleClearConversation() {
    setTranscripts([]);
    setImageAnalyses([]);
    setConversationSummary(null);
    setShowClearConfirm(false);
  }

  async function handleEndConversation() {
    // Check if connected first
    if (!connected) {
      setError("Not connected to server. Please wait for reconnection.");
      return;
    }

    // Mark session as completed - permanently locks chat
    setIsSessionCompleted(true);
    // Show loading immediately (keep dialog open to show progress)
    setIsProcessingSummary(true);

    // Stop any active recording first
    if (isRecording) {
      stopStreaming();
      send({ type: "stop_stream" });
      setIsRecording(false);
    }

    // Close the room on the server (mark as closed in database)
    try {
      const res = await fetch(`/api/rooms/${room.code}/end`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });
      if (res.ok) {
        console.log("[InterpreterView] Room closed in database");
      } else {
        console.error("[InterpreterView] Failed to close room:", res.status);
      }
    } catch (err) {
      console.error("[InterpreterView] Error closing room:", err);
    }

    // Request server to process audio and generate summary
    console.log("[InterpreterView] Sending end_conversation");
    send({ type: "end_conversation" });

    // Timeout fallback - if no response in 60s, show error
    setTimeout(() => {
      setIsProcessingSummary((current) => {
        if (current) {
          setError("Processing timed out. Please try again.");
          setShowCompleteConfirm(false);
          return false;
        }
        return current;
      });
    }, 60000);
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Image too large. Please use an image under 10MB.");
      return;
    }

    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);

    const needsConversion = !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type);

    if (needsConversion) {
      try {
        const converted = await convertImageToJpeg(file);
        setSelectedImageFile(converted);
        setImagePreviewUrl(URL.createObjectURL(converted));
      } catch {
        setSelectedImageFile(file);
        setImagePreviewUrl(URL.createObjectURL(file));
      }
    } else {
      setSelectedImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }

    setShowImageUpload(true);
  }

  async function handleImageSend() {
    if (!selectedImageFile || imageUploading || !langsValid) return;

    setError(null);
    setImageUploading(true);

    try {
      const base64 = await fileToBase64(selectedImageFile);
      send({
        type: "image_analysis",
        imageBase64: base64,
        mimeType: selectedImageFile.type,
        role: myRole,
        doctorLang,
        patientLang,
        description: imageDescription.trim() || undefined,
      });

      setShowImageUpload(false);
      setImageDescription("");
      setSelectedImageFile(null);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
    } catch {
      setError("Failed to process image.");
      setImageUploading(false);
    }
  }

  function handleCancelImage() {
    setShowImageUpload(false);
    setSelectedImageFile(null);
    setImageDescription("");
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  const isDoctor = myRole === "doctor";
  const cardClass = isDoctor ? "split-doctor" : "split-patient";
  const headerClass = isDoctor ? "split-doctor-header" : "split-patient-header";

  // Peer activity label
  const peerActivityLabel = peerActivity === "typing"
    ? `${otherLabel} is typing...`
    : peerActivity === "speaking"
    ? `${otherLabel} is speaking...`
    : peerActivity === "processing"
    ? `${otherLabel}'s message is being translated...`
    : peerActivity === "analyzing_image"
    ? `${otherLabel} sent an image for analysis...`
    : null;

  // If room is closed, show session ended message
  if (room.status === "closed") {
    return (
      <div className="interpreter-view">
        <div className="session-closed-banner">
          <h2>Session Ended</h2>
          <p>This consultation session has been completed.</p>
          <p>You can view the Summary and Certificate tabs for session records.</p>
        </div>
        {/* Show read-only transcript history */}
        <div className="transcript-box">
          {transcripts.length === 0 ? (
            <div className="transcript-empty">No conversation recorded.</div>
          ) : (
            <div className="transcript-list">
              {transcripts.map((t) => (
                <div key={t.id} className={`transcript-item ${t.role}`}>
                  <div className="transcript-role">{t.role === "doctor" ? "Doctor" : "Patient"}</div>
                  <div className="transcript-original">{t.original}</div>
                  <div className="transcript-translated">{t.translated}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="interpreter-view">
      {/* Fullscreen image lightbox */}
      {lightboxSrc && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxSrc(null)}
          role="dialog"
          aria-label="Image viewer"
        >
          <button
            className="lightbox-close"
            onClick={() => setLightboxSrc(null)}
            aria-label="Close image"
          >
            &#10005;
          </button>
          <img
            src={lightboxSrc}
            alt="Full size"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Top bar */}
      <div className="top-bar">
        {/* Each user can only set their OWN language */}
        <div className="lang-selector" role="group" aria-label="Language selection">
          <span className="lang-label">I speak:</span>
          <select
            id="my-lang-select"
            value={myLang}
            onChange={(e) => {
              const newLang = e.target.value as SupportedLang;
              if (isDoctor) {
                setDoctorLang(newLang);
              } else {
                setPatientLang(newLang);
                // Notify peer (doctor) about language change
                send({ type: "update_language", patientLang: newLang });
              }
            }}
            disabled={isStreaming}
            className="lang-select-sm"
            aria-label="My language"
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="lang-arrow" aria-hidden="true">→</span>
          <span className="lang-fixed peer-lang">
            {peerLang ? getLangLabel(peerLang) : "Waiting for peer..."}
          </span>
        </div>

        <div className="top-bar-actions">
          {isDoctor && transcripts.length > 0 && !showCompleteConfirm && !isProcessingSummary && !showCompleteModal && (
            <button
              className="btn-complete-session"
              onClick={() => setShowCompleteConfirm(true)}
              disabled={isRecording || isProcessingSummary || showCompleteModal || isSessionCompleted}
            >
              Complete
            </button>
          )}
          {(transcripts.length > 0 || imageAnalyses.length > 0) && !showClearConfirm && !showCompleteModal && (
            <button
              className="btn-clear-top"
              onClick={() => setShowClearConfirm(true)}
              disabled={showCompleteModal || isSessionCompleted}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {showClearConfirm && (
        <div className="clear-confirm" role="alert">
          <p>Clear all transcripts? This cannot be undone.</p>
          <div className="clear-confirm-buttons">
            <button className="btn-secondary" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={handleClearConversation}>
              Yes, Clear All
            </button>
          </div>
        </div>
      )}

      {showCompleteConfirm && (
        <div className="complete-confirm" role="alert">
          {isProcessingSummary ? (
            <>
              <div className="complete-confirm-processing">
                <span className="spinner-sm" aria-hidden="true" />
                <p>Processing conversation...</p>
              </div>
              <p className="complete-confirm-note">Transcribing audio and generating summary. This may take a moment.</p>
            </>
          ) : (
            <>
              <p>End conversation and generate transcript + summary?</p>
              <p className="complete-confirm-note">Audio will be transcribed using AI.</p>
              <div className="complete-confirm-buttons">
                <button className="btn-secondary" onClick={() => setShowCompleteConfirm(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleEndConversation}>
                  Yes, End & Summarize
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isProcessingSummary && (
        <div className="status-bar status-processing" role="status">
          <span className="spinner-sm" aria-hidden="true" />
          Processing conversation... Transcribing audio and generating summary.
        </div>
      )}

      {!langsValid && (
        <div className={`status-bar ${!peerLang ? "status-waiting" : "status-error"}`} role="alert">
          {!peerLang
            ? `Waiting for ${otherLabel.toLowerCase()} to join and select their language...`
            : "You and your peer must speak different languages."}
        </div>
      )}

      {!connected && (
        <div className="status-bar status-disconnected" role="status" aria-live="polite">
          <span className="reconnecting-spinner" aria-hidden="true" />
          Connection lost. Reconnecting...
          <button className="btn-dismiss" onClick={() => { resetReconnect(); connect(); }} aria-label="Retry now">
            Retry Now
          </button>
        </div>
      )}

      {error && (
        <div className="status-bar status-error" role="alert">
          {error}
          <button className="btn-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
            &#10005;
          </button>
        </div>
      )}

      {/* Single card */}
      <div className="single-card-wrapper">
        <motion.div
          className={`split-card single-card ${cardClass} ${isRecording ? "split-active" : ""}`}
          animate={!shouldReduceMotion && isRecording ? {
            boxShadow: myRole === 'doctor'
              ? "0 0 0 4px rgba(37, 99, 235, 0.2), 0 8px 16px rgba(37, 99, 235, 0.15)"
              : "0 0 0 4px rgba(16, 185, 129, 0.2), 0 8px 16px rgba(16, 185, 129, 0.15)",
            scale: 1.01
          } : {
            boxShadow: "none",
            scale: 1
          }}
          transition={{ duration: 0.2 }}
        >
          <div className={`split-card-header ${headerClass}`}>
            <span className="split-card-title">{isDoctor ? "Doctor" : "Patient"}</span>
            <span className="split-card-lang">{getLangLabel(myLang)}</span>
          </div>

          <div className="split-card-messages" role="log" aria-label="Conversation messages">
            {timeline.length === 0 && !peerActivityLabel && !myProcessing && (
              <p className="split-card-empty">Voice messages will appear here</p>
            )}

            {/* Unified chronological timeline */}
            <AnimatePresence>
              {timeline.map((item) => {
                if (item.kind === "transcript") {
                  const t = item.data;
                  const isSent = t.role === myRole;
                  // Only show messages that have audio (check for non-empty string)
                  const inlineAudio = t.audioBase64 && t.audioBase64.length > 0;
                  const persistedAudio = isSent ? t.originalAudioUrl : t.translatedAudioUrl;
                  const hasAudio = inlineAudio || (persistedAudio && persistedAudio.length > 0);
                  if (!hasAudio) {
                    console.log("[Timeline] Skipping transcript without audio:", t.id, t.role);
                    return null;
                  }

                  return (
                    <motion.div
                      key={t.id}
                      className={`split-msg ${isSent ? "split-msg-sent" : "split-msg-received"}`}
                      layout
                      initial={shouldReduceMotion ? {} : { opacity: 0, y: 15, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={shouldReduceMotion ? {} : { opacity: 0, scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    >
                      <span className="split-msg-who">{isSent ? "You" : otherLabel}</span>

                      {/* Audio-only display - no text */}
                      <AudioPlayButton
                        audioId={t.id}
                        inlineAudio={t.audioBase64}
                        inlineMimeType={t.audioMimeType}
                        audioUrl={isSent ? t.originalAudioUrl : t.translatedAudioUrl}
                        isSent={isSent}
                        playPcmAudio={playPcmAudio}
                        stopAudio={clearPlaybackQueue}
                        authToken={user.token}
                        playingAudioId={playingAudioId}
                        setPlayingAudioId={setPlayingAudioId}
                      />
                      <span className="split-msg-time">
                        {new Date(t.timestamp).toLocaleTimeString()}
                      </span>
                    </motion.div>
                  );
                } else {
                  return (
                    <ImageAnalysisCard
                      key={item.data.id}
                      analysis={item.data}
                      myRole={myRole}
                      onImageClick={setLightboxSrc}
                    />
                  );
                }
              })}
            </AnimatePresence>

            {/* Audio-only mode - no live translation text */}

            {/* My pending states */}
            {myProcessing && (
              <div className="split-msg split-msg-sent split-msg-live">
                <span className="split-msg-who">You</span>
                <span className="split-msg-streaming">sending...</span>
              </div>
            )}
            {imageUploading && (
              <div className="split-msg split-msg-sent split-msg-live">
                <span className="split-msg-who">You</span>
                <span className="split-msg-streaming">analyzing image...</span>
              </div>
            )}

            {/* Peer activity indicator */}
            <AnimatePresence>
              {peerActivityLabel && (
                <motion.div
                  className="peer-activity-indicator"
                  role="status"
                  aria-live="polite"
                  initial={shouldReduceMotion ? {} : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={shouldReduceMotion ? {} : { opacity: 0, height: 0 }}
                >
                  <span className="peer-activity-dots">
                    {!shouldReduceMotion ? (
                      <>
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            animate={typingDot(i * 0.15)}
                            style={{
                              display: "inline-block",
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              background: "var(--warm-gray-400)",
                              marginRight: i < 2 ? 3 : 0,
                            }}
                          />
                        ))}
                      </>
                    ) : (
                      <>
                        <span /><span /><span />
                      </>
                    )}
                  </span>
                  {peerActivityLabel}
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>

          {/* Image upload panel */}
          {showImageUpload && imagePreviewUrl && (
            <div className="img-upload-panel">
              <div className="img-upload-preview-row">
                <img src={imagePreviewUrl} alt="Selected" className="img-upload-thumb" />
                <textarea
                  className="img-upload-desc"
                  placeholder="Describe the issue (optional)..."
                  value={imageDescription}
                  onChange={(e) => setImageDescription(e.target.value)}
                  rows={2}
                  maxLength={500}
                />
              </div>
              <div className="img-upload-actions">
                <button className="btn-secondary" onClick={handleCancelImage}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleImageSend}
                  disabled={imageUploading}
                >
                  {imageUploading ? "Analyzing..." : "Send for Analysis"}
                </button>
              </div>
            </div>
          )}

          <div className="split-card-input">
            {/* Mic button with label */}
            <div className="mic-wrapper">
              <motion.button
                className={`split-mic ${isRecording ? "split-mic-stop" : ""}`}
                onClick={isRecording ? handleStopRecording : handleStartRecording}
                whileHover={shouldReduceMotion || !connected ? {} : iconButtonHover}
                whileTap={shouldReduceMotion || !connected ? {} : iconButtonTap}
                disabled={!connected || !langsValid || isProcessingSummary || showCompleteModal || isSessionCompleted}
                aria-label={isRecording ? "Tap to stop" : "Tap to speak"}
              >
                {isRecording ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                )}
              </motion.button>
              <span className={`mic-label ${isRecording ? "recording" : ""}`}>
                {isRecording ? "TAP TO STOP" : "TAP TO TALK"}
              </span>
            </div>

            <textarea
              className="split-text-input"
              placeholder={isProcessingSummary ? "Processing summary..." : `Type in ${getLangLabel(myLang)}...`}
              value={myText}
              onChange={(e) => {
                setMyText(e.target.value);
                if (e.target.value.trim()) notifyTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSend();
                }
              }}
              disabled={!connected || myProcessing || isProcessingSummary || showCompleteModal || isSessionCompleted}
              rows={1}
              maxLength={5000}
              aria-label="Type your message"
            />
            <button
              className="split-send"
              onClick={handleTextSend}
              disabled={!connected || myProcessing || !myText.trim() || !langsValid || isProcessingSummary || showCompleteModal || isSessionCompleted}
              aria-label="Send"
            >
              {myProcessing ? (
                <span className="spinner-sm" aria-hidden="true" />
              ) : (
                "\u27A4"
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Live recording indicator */}
      {isRecording && (
        <div
          className={`live-indicator live-${myRole} live-status-${streamStatus}`}
          role="status"
          aria-live="assertive"
        >
          <span className={`live-dot ${streamStatus === "agent_speaking" ? "live-dot-speaking" : ""}`} aria-hidden="true" />
          <span className="live-label">
            {streamStatus === "listening" && "LISTENING"}
            {streamStatus === "speech_detected" && "SPEAKING"}
            {streamStatus === "agent_processing" && "PROCESSING"}
            {streamStatus === "agent_speaking" && "TRANSLATING"}
            {streamStatus === "idle" && "LIVE"}
          </span>
          <span className="live-timer">{statusDuration.toFixed(1)}s</span>
          <span className="live-status-detail">
            {streamStatus === "listening" && "Waiting for speech..."}
            {streamStatus === "speech_detected" && "Sending to interpreter..."}
            {streamStatus === "agent_processing" && "Preparing translation..."}
            {streamStatus === "agent_speaking" && "Playing translation..."}
          </span>
          <button className="btn-stop" onClick={handleStopRecording} aria-label="Stop recording">
            Stop
          </button>
        </div>
      )}

      {/* Session complete modal */}
      {showCompleteModal && (() => {
        console.log("InterpreterView: Rendering SessionCompleteModal, participantProfile =", participantProfile ? JSON.stringify(participantProfile) : "null");
        return (
          <SessionCompleteModal
            transcripts={transcripts}
            doctorLang={doctorLang}
            patientLang={patientLang}
            user={user}
            participantProfile={participantProfile}
            room={room}
            onClose={() => setShowCompleteModal(false)}
            onCertificateGenerated={(certificate) => {
              // Share certificate with patient via WebSocket
              send({ type: "share_certificate", certificate });
              // Also show the certificate viewer for the doctor
              setSharedCertificate(certificate);
              setShowCertificateViewer(true);
              setShowCompleteModal(false);
            }}
            onCertificateDataGenerated={onCertificateGeneratedProp}
          />
        );
      })()}

      {/* Conversation summary modal */}
      {showSummaryModal && conversationSummary && (
        <div className="modal-overlay" onClick={() => setShowSummaryModal(false)}>
          <div className="modal-content summary-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Conversation Summary</h2>
              <button
                className="btn-dismiss"
                onClick={() => setShowSummaryModal(false)}
                aria-label="Close"
              >
                &#10005;
              </button>
            </div>
            <div className="modal-body">
              <div className="summary-stats">
                <span>Duration: {conversationSummary.durationMinutes} min</span>
                <span>Turns: {conversationSummary.segments.length}</span>
              </div>
              <div className="summary-text">
                <h3>Summary</h3>
                <p>{conversationSummary.summary}</p>
              </div>
              <div className="summary-actions">
                {isDoctor && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setShowSummaryModal(false);
                      setShowCompleteModal(true);
                    }}
                  >
                    Generate Certificate
                  </button>
                )}
                <button className="btn-secondary" onClick={() => setShowSummaryModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Certificate viewer modal (for both doctor and patient) */}
      {showCertificateViewer && sharedCertificate && (
        <CertificateViewerModal
          certificate={sharedCertificate}
          myRole={myRole}
          onClose={() => setShowCertificateViewer(false)}
        />
      )}
    </div>
  );
}

// --- Audio Play Button (handles both inline and URL-based audio with play/pause) ---
function AudioPlayButton({
  audioId,
  inlineAudio,
  inlineMimeType,
  audioUrl,
  isSent,
  playPcmAudio,
  stopAudio,
  authToken,
  playingAudioId,
  setPlayingAudioId,
}: {
  audioId: string;
  inlineAudio?: string;
  inlineMimeType?: string;
  audioUrl?: string;
  isSent: boolean;
  playPcmAudio: (base64: string, mimeType: string) => void;
  stopAudio: () => void;
  authToken: string;
  playingAudioId: string | null;
  setPlayingAudioId: (id: string | null) => void;
}) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlaying = playingAudioId === audioId;

  const hasAudio = inlineAudio || audioUrl;
  if (!hasAudio) return null;

  const handleClick = async () => {
    // If this audio is playing, stop it
    if (isPlaying) {
      stopAudio();
      setPlayingAudioId(null);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Stop any other playing audio first
    if (playingAudioId) {
      stopAudio();
    }

    setPlayingAudioId(audioId);

    try {
      let durationMs = 1000;

      // Prefer inline audio (real-time, no network request)
      if (inlineAudio) {
        const mimeType = inlineMimeType || (isSent ? "audio/pcm;rate=16000" : "audio/pcm;rate=24000");
        playPcmAudio(inlineAudio, mimeType);
        durationMs = Math.max(1000, (inlineAudio.length * 0.75 / 32000) * 1000);
      } else if (audioUrl) {
        // Fall back to URL-based audio (persisted in GCS via API)
        const response = await fetch(audioUrl, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        // Convert to base64 safely (handle large arrays)
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const mimeType = isSent ? "audio/pcm;rate=16000" : "audio/pcm;rate=24000";
        playPcmAudio(base64, mimeType);
        durationMs = Math.max(1000, (arrayBuffer.byteLength / 32000) * 1000);
      }

      // Auto-reset playing state when audio finishes
      timeoutRef.current = setTimeout(() => {
        setPlayingAudioId(null);
        timeoutRef.current = null;
      }, durationMs);
    } catch (err) {
      console.error("[Audio] Failed to play:", err);
      setPlayingAudioId(null);
    }
  };

  return (
    <button
      className={`split-msg-audio-btn ${isPlaying ? "audio-playing" : ""}`}
      onClick={handleClick}
      aria-label={isPlaying ? "Stop audio" : "Play audio"}
    >
      {isPlaying ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      )}
      {isPlaying ? "Stop" : "Play"}
    </button>
  );
}

// --- Transcript Card (with optional audio replay) ---
function TranscriptCard({
  transcript: t,
  audio,
  isSent,
  otherLabel,
  shouldReduceMotion,
  playPcmAudio,
  authToken,
}: {
  transcript: TranscriptEntry;
  audio?: AudioMessageEntry;
  isSent: boolean;
  otherLabel: string;
  shouldReduceMotion: boolean;
  playPcmAudio: (base64: string, mimeType: string) => void;
  authToken: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  // Determine which audio to use:
  // - For sent messages (own): use originalAudioUrl or inline audio
  // - For received messages (peer): use translatedAudioUrl or inline audio
  const audioUrl = isSent ? t.originalAudioUrl : t.translatedAudioUrl;
  const hasAudio = audioUrl || audio;

  const handlePlay = async () => {
    setIsPlaying(true);

    try {
      // Prefer URL-based audio (persisted in GCS via API)
      if (audioUrl) {
        const response = await fetch(audioUrl, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const mimeType = isSent ? "audio/pcm;rate=16000" : "audio/pcm;rate=24000";
        playPcmAudio(base64, mimeType);
        const durationMs = Math.max(1000, (arrayBuffer.byteLength / 32000) * 1000);
        setTimeout(() => setIsPlaying(false), durationMs);
      } else if (audio) {
        // Fall back to inline audio from WebSocket
        playPcmAudio(audio.audioBase64, audio.mimeType);
        const durationMs = Math.max(1000, (audio.audioBase64.length / 32000) * 1000);
        setTimeout(() => setIsPlaying(false), durationMs);
      }
    } catch (err) {
      console.error("[Audio] Failed to play from URL:", err);
      setIsPlaying(false);
    }
  };

  return (
    <motion.div
      className={`split-msg ${isSent ? "split-msg-sent" : "split-msg-received"}`}
      layout
      initial={shouldReduceMotion ? {} : { opacity: 0, y: 15, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={shouldReduceMotion ? {} : { opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <span className="split-msg-who">{isSent ? "You" : otherLabel}</span>
      <div className="split-msg-text" lang={isSent ? t.originalLang : t.translatedLang}>
        {isSent ? t.original : (t.translated || t.original)}
      </div>
      {!isSent && t.translated && t.original && (
        <div className="split-msg-original" lang={t.originalLang}>
          {t.original}
        </div>
      )}
      {!isSent && !t.translated && t.original && (
        <span className="split-msg-streaming">translating...</span>
      )}
      {/* Audio replay button - show if audio URL or inline audio exists */}
      {hasAudio && (
        <button
          className={`audio-replay-btn ${isPlaying ? "audio-playing" : ""}`}
          onClick={handlePlay}
          disabled={isPlaying}
          aria-label={isPlaying ? "Playing..." : "Replay audio"}
        >
          {isPlaying ? "Playing..." : "Replay"}
        </button>
      )}
      <span className="split-msg-time">
        {new Date(t.timestamp).toLocaleTimeString()}
      </span>
    </motion.div>
  );
}

// --- Audio Message Card (fallback when no transcription) ---
function AudioMessageCard({
  audio,
  isSent,
  otherLabel,
  playPcmAudio,
}: {
  audio: AudioMessageEntry;
  isSent: boolean;
  otherLabel: string;
  playPcmAudio: (base64: string, mimeType: string) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    setIsPlaying(true);
    playPcmAudio(audio.audioBase64, audio.mimeType);
    const durationMs = Math.max(1000, (audio.audioBase64.length / 32000) * 1000);
    setTimeout(() => setIsPlaying(false), durationMs);
  };

  return (
    <div className={`split-msg audio-msg ${isSent ? "split-msg-sent" : "split-msg-received"}`}>
      <span className="split-msg-who">{isSent ? "You" : otherLabel}</span>
      <div className="audio-msg-content">
        <button
          className={`audio-play-btn ${isPlaying ? "audio-playing" : ""}`}
          onClick={handlePlay}
          disabled={isPlaying}
          aria-label={isPlaying ? "Playing..." : "Play audio"}
        >
          {isPlaying ? "Playing..." : "Play Voice"}
        </button>
      </div>
      <span className="split-msg-time">
        {new Date(audio.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

// --- Image Analysis Card ---
function ImageAnalysisCard({
  analysis,
  myRole,
  onImageClick,
}: {
  analysis: ImageAnalysisEntry;
  myRole: "doctor" | "patient";
  onImageClick: (src: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSent = analysis.senderRole === myRole;
  const senderLabel = isSent ? "You" : analysis.senderRole === "doctor" ? "Doctor" : "Patient";

  const severityColors: Record<string, string> = {
    low: "var(--patient-color)",
    moderate: "var(--warning-border)",
    high: "var(--danger)",
    unknown: "var(--gray-500)",
  };

  return (
    <div className={`img-analysis-card ${isSent ? "img-analysis-sent" : "img-analysis-received"}`}>
      <div className="img-analysis-header">
        <img
          src={analysis.imagePreview}
          alt="Submitted"
          className="img-analysis-thumb img-clickable"
          onClick={() => onImageClick(analysis.imagePreview)}
          title="Click to view full image"
        />
        <div className="img-analysis-header-text" onClick={() => setExpanded(!expanded)}>
          <span className="split-msg-who">{senderLabel} shared an image</span>
          <span
            className="img-severity-badge"
            style={{ background: severityColors[analysis.result.severity] }}
          >
            {analysis.result.severity}
          </span>
        </div>
        <button
          className="btn-dismiss"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "\u25B2" : "\u25BC"}
        </button>
      </div>

      {expanded && (
        <div className="img-analysis-body">
          {analysis.result.imageQuality && analysis.result.imageQuality !== "clear" && (
            <div className={`img-quality-warning ${analysis.result.imageQuality === "insufficient" ? "img-quality-insufficient" : "img-quality-unclear"}`}>
              {analysis.result.imageQuality === "insufficient"
                ? "Image quality is insufficient for reliable assessment. Please submit a clearer photo."
                : "Image quality is unclear. Results may be less accurate."}
            </div>
          )}
          <div className="img-analysis-section">
            <h4>Observations</h4>
            <p>{analysis.result.observations}</p>
          </div>

          {analysis.result.possibleConditions.length > 0 && (
            <div className="img-analysis-section">
              <h4>Possible Conditions</h4>
              <ol className="img-conditions-list">
                {analysis.result.possibleConditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="img-analysis-section">
            <h4>Recommendations</h4>
            <p>{analysis.result.recommendations}</p>
          </div>

          <div className="img-analysis-disclaimer">
            {analysis.result.disclaimer}
          </div>
        </div>
      )}

      <span className="split-msg-time">
        {new Date(analysis.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

// --- Utilities ---

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function convertImageToJpeg(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const MAX = 4096;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas conversion failed"));
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, ".jpg");
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for conversion"));
    };

    img.src = url;
  });
}
