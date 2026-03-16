import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import crypto from "crypto";
import { LiveInterpreterSession } from "./services/geminiLive";
// VAD removed - frontend handles pause detection now
import { genai, translateTextStreaming, isValidLang, getLangName, sanitizeForPrompt, withTimeout, summarizeConversation } from "./services/gemini";
import { synthesizeSpeech } from "./services/tts";
import { getRoom, saveTranscript, getTranscriptsForRoom } from "./services/firestore";
import { verifyToken } from "./middleware/auth";
import { WSRateLimiter } from "./middleware/rateLimiter";
import { classifyGeminiError } from "./middleware/errorHandler";
import { analytics, estimateTokens, estimateAudioTokens, calculateAudioTokenCost } from "./services/analytics";
import {
  startConversation,
  addAudioSegment,
  clearConversation,
} from "./services/conversationAudio";
import { saveTranscriptAudio, getTranscriptAudio } from "./services/audioStorage";
import { transcribeConversationAudio } from "./services/speechToText";
import type {
  WSClientMessage,
  WSServerMessage,
  TranscriptEntry,
  ImageAnalysisResult,
} from "./types";

function log(clientId: string, ...args: unknown[]) {
  console.log(`[WS ${clientId.slice(0, 8)}]`, new Date().toISOString(), ...args);
}

// Combine base64 audio chunks into a single base64 string
function combineBase64Audio(chunks: string[]): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0];

  // Decode all chunks to buffers and concatenate
  const buffers = chunks.map(chunk => Buffer.from(chunk, "base64"));
  const combined = Buffer.concat(buffers);
  return combined.toString("base64");
}

function logError(clientId: string, ...args: unknown[]) {
  console.error(`[WS ${clientId.slice(0, 8)}]`, new Date().toISOString(), ...args);
}

function send(ws: WebSocket, msg: WSServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
      // Debug: log successful audio_message sends
      if (msg.type === "audio_message") {
        console.log(`[WS] Sent audio_message successfully: id=${(msg as any).id}`);
      }
    } catch (err) {
      console.error("[WS] Failed to send message:", err);
    }
  } else {
    console.warn("[WS] Tried to send on non-OPEN socket, state:", ws.readyState, "type:", msg.type);
  }
}

// ----- Constants -----

const HEARTBEAT_INTERVAL = 30_000;
const MAX_CONNECTIONS = 50;
const MAX_LIVE_SESSIONS = 10;
const MAX_TRANSCRIPTS_PER_CONNECTION = 200;

let activeLiveSessions = 0;

// ----- Room connection registry -----

interface RoomConnections {
  doctor?: WebSocket;
  patient?: WebSocket;
}

// Keyed by room code
const roomConnections = new Map<string, RoomConnections>();

function getRoomConns(code: string): RoomConnections {
  let conns = roomConnections.get(code);
  if (!conns) {
    conns = {};
    roomConnections.set(code, conns);
  }
  return conns;
}

function sendToRoom(
  code: string,
  msg: WSServerMessage,
  exclude?: WebSocket
) {
  const conns = roomConnections.get(code);
  if (!conns) return;

  for (const ws of [conns.doctor, conns.patient]) {
    if (ws && ws !== exclude) {
      send(ws, msg);
    }
  }
}

function removeFromRoom(code: string, ws: WebSocket) {
  const conns = roomConnections.get(code);
  if (!conns) return;

  if (conns.doctor === ws) conns.doctor = undefined;
  if (conns.patient === ws) conns.patient = undefined;

  // Clean up empty room entries
  if (!conns.doctor && !conns.patient) {
    roomConnections.delete(code);
  }
}

// ----- WebSocket setup -----

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws/interpret",
    maxPayload: 5 * 1024 * 1024, // 5MB (images can be large)
  });

  // Expose wss for graceful shutdown
  (server as any).__wss = wss;

  const wsRateLimiter = new WSRateLimiter(60);

  // Heartbeat to detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.isAlive === false) {
        console.log("[WS] Terminating dead connection");
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeat);
    wsRateLimiter.destroy();
  });

  wss.on("connection", (ws: any) => {
    if (wss.clients.size > MAX_CONNECTIONS) {
      ws.close(1013, "Server is at capacity. Please try again later.");
      return;
    }

    const clientId = crypto.randomUUID();
    log(clientId, "Connected (total:", wss.clients.size, ")");

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Per-connection state
    let liveSession: LiveInterpreterSession | null = null;
    const transcripts: TranscriptEntry[] = [];
    let streamQueue: Promise<void> = Promise.resolve();

    // Track if user is actively streaming (hasn't clicked stop)
    let isUserStreaming = false;
    let currentStreamRole: "doctor" | "patient" | null = null;
    let currentDoctorLang: string | null = null;
    let currentPatientLang: string | null = null;
    let currentGender: "male" | "female" = "male";
    let turnCount = 0; // Track turns within a streaming session
    // Audio accumulator for current speech segment (for post-conversation processing)
    let currentSegmentAudio: string[] = [];
    // Timing for analytics
    let turnStartTime: number | null = null;

    // Room state — populated after successful join_room
    let roomCode: string | null = null;
    let clientRole: "doctor" | "patient" | null = null;
    let clientUsername: string | null = null;

    function cleanupLiveSession() {
      // Clear current segment audio
      currentSegmentAudio = [];

      if (liveSession) {
        log(clientId, "Cleaning up live session");
        console.log(`[Live Agent] Session ended for ${clientUsername || "unknown"} (${clientRole || "unknown role"}) in room ${roomCode || "no room"}`);
        liveSession.removeAllListeners();
        liveSession.close();
        liveSession = null;
        activeLiveSessions = Math.max(0, activeLiveSessions - 1);
        log(clientId, "Live session cleaned up, active sessions:", activeLiveSessions);
      }
    }

    // Track if agent is currently speaking (to avoid duplicate status)
    let agentSpeakingNotified = false;

    // Track audio chunks sent to peer for debugging
    let audioChunksSentToPeer = 0;

    // Store translation audio (from Gemini) for receiver replay
    let translationAudioChunks: string[] = [];

    // Track current turn's transcriptions for analytics
    let currentTurnInputText = "";
    let currentTurnOutputText = "";

    function setupLiveSessionListeners(session: LiveInterpreterSession) {
      session.on(
        "audio_chunk",
        (chunk: { data: string; mimeType: string }) => {
          // Log first chunk to confirm Gemini is responding
          audioChunksSentToPeer++;
          if (audioChunksSentToPeer === 1) {
            log(clientId, `Gemini Live responding with audio (first chunk, mime: ${chunk.mimeType})`);
          }
          if (audioChunksSentToPeer % 20 === 0) {
            log(clientId, `Audio chunks sent to peer: ${audioChunksSentToPeer}`);
          }

          // Notify sender that agent is speaking (only once per turn)
          if (!agentSpeakingNotified) {
            agentSpeakingNotified = true;
            send(ws, { type: "stream_status", status: "agent_speaking" });
          }

          // Store translation audio for replay
          translationAudioChunks.push(chunk.data);

          // Send translation AUDIO to the PEER (receiver hears the translation)
          if (roomCode) {
            const peerWs = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;
            if (peerWs && peerWs.readyState === WebSocket.OPEN) {
              send(peerWs, {
                type: "audio_chunk",
                audio: chunk.data,
                mimeType: chunk.mimeType,
              });
            } else {
              log(clientId, `Cannot send audio to peer: peerWs=${!!peerWs}, state=${peerWs?.readyState}`);
            }
          } else {
            log(clientId, "Cannot send audio: no roomCode");
          }
        }
      );

      session.on("interrupted", () => {
        log(clientId, "Live session interrupted");
        agentSpeakingNotified = false;
        send(ws, { type: "stream_status", status: "listening" });
        send(ws, { type: "interrupted" });
      });

      // Filter out noise/silence markers and empty content
      function isValidTranscription(text: string): boolean {
        if (!text || typeof text !== "string") return false;
        const cleaned = text.trim();
        if (cleaned.length === 0) return false;
        // Filter out noise/silence markers (Gemini uses these)
        const noisePatterns = [
          /^<noise>$/i,
          /^<silence>$/i,
          /^\(noise\)$/i,
          /^\(silence\)$/i,
          /^\[noise\]$/i,
          /^\[silence\]$/i,
          /^noise$/i,
          /^silence$/i,
        ];
        for (const pattern of noisePatterns) {
          if (pattern.test(cleaned)) return false;
        }
        // Filter out very short utterances that are likely just filler sounds
        // (less than 4 real characters after removing punctuation and common filler sounds)
        const withoutPunctuation = cleaned.replace(/[。、．，！？!?,.\s・]/g, "");
        // Also filter repeated single character sounds like "ああ", "うう", etc.
        const withoutFillers = withoutPunctuation.replace(/(.)\1+/g, "$1"); // collapse repeated chars
        if (withoutFillers.length < 3) return false;
        return true;
      }

      // Handle input transcription (what speaker said - original language)
      // NOTE: Gemini's input transcription auto-detects language and is often wrong
      // for short utterances. We only use it for analytics, NOT for display.
      session.on("input_transcription", (data: { text: string; role: string; lang: string }) => {
        log(clientId, `Input transcription: "${data.text.substring(0, 50)}..."`);

        // Filter out noise/silence
        if (!isValidTranscription(data.text)) {
          log(clientId, "Filtered out noise/silence transcription");
          return;
        }

        // Accumulate for analytics tracking only
        currentTurnInputText += (currentTurnInputText ? " " : "") + data.text;

        // NOTE: We do NOT send input transcription to clients because:
        // 1. Gemini auto-detects language and often transcribes in wrong language
        // 2. Users hear their own audio anyway via the audio_message
        // 3. The translation (output_transcription) is the important part
        // If you want to re-enable this, uncomment below:
        // send(ws, {
        //   type: "transcription_final",
        //   text: data.text,
        //   source: "sender",
        // });
        // if (roomCode) {
        //   const peerWs = clientRole === "doctor"
        //     ? roomConnections.get(roomCode)?.patient
        //     : roomConnections.get(roomCode)?.doctor;
        //   if (peerWs) {
        //     send(peerWs, {
        //       type: "transcription_final",
        //       text: data.text,
        //       source: "peer_original",
        //     });
        //   }
        // }
      });

      // Handle output transcription (translation - target language)
      session.on("output_transcription", (data: { text: string; role: string; lang: string }) => {
        log(clientId, `Output transcription: "${data.text.substring(0, 50)}..." (audio chunks sent: ${audioChunksSentToPeer})`);

        // Filter out noise/silence
        if (!isValidTranscription(data.text)) {
          log(clientId, "Filtered out noise/silence translation");
          return;
        }

        // Accumulate for analytics tracking
        currentTurnOutputText += (currentTurnOutputText ? " " : "") + data.text;

        // Send transcription to peer even without audio
        // (Gemini sometimes returns transcription without audio chunks)
        // The peer will still see the translation text
        if (roomCode) {
          const peerWs = clientRole === "doctor"
            ? roomConnections.get(roomCode)?.patient
            : roomConnections.get(roomCode)?.doctor;
          if (peerWs) {
            send(peerWs, {
              type: "transcription_final",
              text: data.text,
              source: "translation",
            });
          }
        }
      });

      session.on(
        "turn_complete",
        (data: { role: "doctor" | "patient"; fromLang: string; toLang: string }) => {
          // Reset agent speaking flag for next turn
          agentSpeakingNotified = false;
          turnCount++;

          // Calculate processing time
          const processingTimeMs = turnStartTime ? Date.now() - turnStartTime : 0;
          turnStartTime = null;

          // Back to listening for next speech
          send(ws, { type: "stream_status", status: "listening" });

          // Store audio segment for post-conversation processing AND send as audio messages
          // Only send audio_message when we have BOTH input AND output (valid translation)
          if (roomCode && currentSegmentAudio.length > 0) {
            const senderAudio = combineBase64Audio(currentSegmentAudio);
            const translationAudio = translationAudioChunks.length > 0
              ? combineBase64Audio(translationAudioChunks)
              : "";

            log(clientId, `Turn audio summary: senderChunks=${currentSegmentAudio.length}, translationChunks=${translationAudioChunks.length}, senderSize=${senderAudio.length}, translationSize=${translationAudio.length}`);

            if (translationAudioChunks.length === 0) {
              console.warn(`[WARNING] No translation audio for turn ${turnCount} - Gemini did not generate audio output`);
            }

            addAudioSegment(roomCode, data.role, senderAudio, data.fromLang, data.toLang);

            const timestamp = Date.now();

            // Calculate audio metrics
            const inputAudioBytes = Math.ceil(senderAudio.length * 0.75);
            const inputDurationMs = (inputAudioBytes / 32000) * 1000;
            const inputTokens = estimateAudioTokens(inputDurationMs);

            const outputAudioBytes = translationAudio ? Math.ceil(translationAudio.length * 0.75) : 0;
            const outputDurationMs = (outputAudioBytes / 48000) * 1000;
            const outputTokens = estimateAudioTokens(outputDurationMs);

            // Track analytics
            const costUsd = calculateAudioTokenCost(inputTokens, outputTokens, true);
            log(clientId, `Tracking analytics: roomCode=${roomCode}, inputTokens=${inputTokens}, outputTokens=${outputTokens}, cost=$${costUsd.toFixed(6)}`);
            analytics.trackGeminiCall({
              userId: clientUsername || "anonymous",
              sessionId: roomCode!,
              roomCode: roomCode!,
              operation: "live-translation",
              agent: "gemini-2.5-flash-native-audio",
              model: "gemini-2.5-flash-native-audio",
              inputTokens,
              outputTokens,
              latencyMs: processingTimeMs,
              inputType: "audio",
              fromLang: data.fromLang,
              toLang: data.toLang,
              success: true,
              metadata: {
                role: data.role,
                inputAudioMs: Math.round(inputDurationMs),
                costUsd,
              },
            });

            // Track detailed Live Agent call
            if (liveSession && (currentTurnInputText || currentTurnOutputText)) {
              analytics.trackLiveAgentCall({
                userId: clientUsername || "anonymous",
                username: clientUsername || "anonymous",
                sessionId: roomCode!,
                roomCode: roomCode!,
                speakerRole: data.role,
                speakerGender: currentGender,
                voiceModel: liveSession.getVoiceModel(),
                fromLang: data.fromLang,
                fromLangName: getLangName(data.fromLang),
                toLang: data.toLang,
                toLangName: getLangName(data.toLang),
                systemPrompt: liveSession.getSystemPrompt(),
                userText: currentTurnInputText,
                responseText: currentTurnOutputText,
                inputTokens,
                outputTokens,
                processingDurationMs: processingTimeMs,
                costUsd,
                inputAudioDurationMs: Math.round(inputDurationMs),
                outputAudioDurationMs: Math.round(outputDurationMs),
                isAudioGenerated: translationAudioChunks.length > 0,
                success: true,
              }).catch((err) => {
                log(clientId, "Failed to track live agent call:", err);
              });
            }

            // Build transcript entry with whatever we have (text and/or audio)
            const transcriptId = crypto.randomUUID();
            const transcriptEntry: TranscriptEntry = {
              id: transcriptId,
              role: data.role,
              original: currentTurnInputText.trim(),
              translated: currentTurnOutputText.trim(),
              originalLang: data.fromLang,
              translatedLang: data.toLang,
              timestamp,
            };

            // Get peer WebSocket
            const peerWs = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;

            // Send ONE combined message to SENDER (with their original audio)
            log(clientId, `Sending transcript+audio to SENDER: id=${transcriptId}, hasOriginalAudio=${senderAudio.length > 0}`);
            send(ws, {
              type: "transcript",
              entry: transcriptEntry,
              audioBase64: senderAudio || undefined,
              audioMimeType: senderAudio ? "audio/pcm;rate=16000" : undefined,
            });

            // Send ONE combined message to RECEIVER (with translation audio)
            if (peerWs) {
              log(clientId, `Sending transcript+audio to RECEIVER: id=${transcriptId}, hasTranslationAudio=${translationAudio.length > 0}`);
              send(peerWs, {
                type: "transcript",
                entry: transcriptEntry,
                audioBase64: translationAudio || undefined,
                audioMimeType: translationAudio ? "audio/pcm;rate=24000" : undefined,
              });
            }

            log(clientId, `Turn ${turnCount}: sent transcript with audio - original: ${Math.round(senderAudio.length / 1024)}KB, translation: ${Math.round((translationAudio?.length || 0) / 1024)}KB`);

            // Save audio to GCS for persistence (async, background)
            (async () => {
              try {
                if (senderAudio && senderAudio.length > 0) {
                  const originalUrl = await saveTranscriptAudio(
                    roomCode!,
                    transcriptId,
                    senderAudio,
                    "original",
                    "audio/pcm;rate=16000"
                  );
                  if (originalUrl) {
                    transcriptEntry.originalAudioUrl = originalUrl;
                  }
                }

                if (translationAudio && translationAudio.length > 0) {
                  const translatedUrl = await saveTranscriptAudio(
                    roomCode!,
                    transcriptId,
                    translationAudio,
                    "translated",
                    "audio/pcm;rate=24000"
                  );
                  if (translatedUrl) {
                    transcriptEntry.translatedAudioUrl = translatedUrl;
                  }
                }
              } catch (err) {
                logError(clientId, "Failed to save audio to GCS:", err instanceof Error ? err.message : err);
              }

              // Save transcript with audio URLs to Firestore
              saveTranscript(roomCode!, transcriptEntry).catch((err: unknown) => {
                logError(clientId, "Failed to persist live transcript:", err instanceof Error ? err.message : err);
              });
              log(clientId, `Saved transcript to Firestore: original=${!!transcriptEntry.originalAudioUrl}, translated=${!!transcriptEntry.translatedAudioUrl}`);
            })();

            log(clientId, `Analytics: ${inputTokens} input tokens, ${outputTokens} output tokens, $${costUsd.toFixed(6)}, ${processingTimeMs}ms`);

            currentSegmentAudio = [];
            translationAudioChunks = [];
            // Reset turn transcription trackers
            currentTurnInputText = "";
            currentTurnOutputText = "";
            // Reset audio chunk counter for next turn
            audioChunksSentToPeer = 0;
          }

          // Notify peer that a turn completed (for UI feedback)
          if (roomCode) {
            const peerWs = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;
            if (peerWs) {
              send(peerWs, { type: "peer_activity", activity: "idle" });
            }
          }
        }
      );

      session.on("error", async (errMsg: string) => {
        logError(clientId, "Live session error:", errMsg);

        // Clear pending audio on error - don't send standalone audio without transcript
        if (currentSegmentAudio.length > 0) {
          log(clientId, `Discarding pending audio on error (no transcript): size=${combineBase64Audio(currentSegmentAudio).length}`);
          currentSegmentAudio = [];
          translationAudioChunks = [];
        }

        // For timeout errors, auto-reconnect if user is still streaming
        const isTimeoutError = errMsg.toLowerCase().includes("timeout") || errMsg.toLowerCase().includes("inactivity");

        if (isTimeoutError && isUserStreaming && currentStreamRole && currentDoctorLang && currentPatientLang) {
          log(clientId, "Session timed out, auto-reconnecting...");

          // Clean up old session
          if (liveSession) {
            liveSession.removeAllListeners();
            liveSession = null;
            activeLiveSessions = Math.max(0, activeLiveSessions - 1);
          }

          // Create new session
          if (activeLiveSessions < MAX_LIVE_SESSIONS) {
            activeLiveSessions++;
            liveSession = new LiveInterpreterSession(currentStreamRole, currentDoctorLang, currentPatientLang, currentGender);
            setupLiveSessionListeners(liveSession);

            try {
              await liveSession.connect();
              log(clientId, "Timeout auto-reconnect successful");
              send(ws, { type: "stream_status", status: "listening" });
            } catch (err) {
              logError(clientId, "Timeout auto-reconnect failed:", err);
              isUserStreaming = false;
              send(ws, { type: "error", message: "Session reconnect failed. Please restart." });
              cleanupLiveSession();
            }
          }
        } else {
          // For other errors, stop streaming
          isUserStreaming = false;
          send(ws, { type: "error", message: errMsg });
        }
      });

      session.on("close", async () => {
        log(clientId, "Live session closed by remote, isUserStreaming:", isUserStreaming);

        // If user is still streaming (hasn't clicked stop), auto-reconnect
        if (isUserStreaming && currentStreamRole && currentDoctorLang && currentPatientLang) {
          log(clientId, "Auto-reconnecting session for continuous streaming...");

          // Clean up old session
          if (liveSession) {
            liveSession.removeAllListeners();
            liveSession = null;
            activeLiveSessions = Math.max(0, activeLiveSessions - 1);
          }

          // Create new session
          if (activeLiveSessions < MAX_LIVE_SESSIONS) {
            activeLiveSessions++;
            liveSession = new LiveInterpreterSession(currentStreamRole, currentDoctorLang, currentPatientLang, currentGender);
            setupLiveSessionListeners(liveSession);

            try {
              await liveSession.connect();
              log(clientId, "Auto-reconnect successful");
            } catch (err) {
              logError(clientId, "Auto-reconnect failed:", err);
              isUserStreaming = false;
              send(ws, { type: "stream_ended" });
              cleanupLiveSession();
            }
          } else {
            log(clientId, "Cannot auto-reconnect - max sessions reached");
            isUserStreaming = false;
            send(ws, { type: "stream_ended" });
          }
        } else {
          send(ws, { type: "stream_ended" });
        }
      });
    }

    async function handleMessage(data: Buffer) {
      let msg: WSClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        logError(clientId, "Invalid JSON received");
        send(ws, { type: "error", message: "Invalid message format." });
        return;
      }

      // Skip rate limiting for audio_chunk (real-time streaming data)
      if (msg.type !== "audio_chunk") {
        if (!wsRateLimiter.allow(clientId)) {
          log(clientId, "Rate limited");
          send(ws, {
            type: "error",
            message: "Sending too fast. Please slow down.",
          });
          return;
        }
        log(clientId, "Received message:", msg.type);
      }

      switch (msg.type) {
        // ----- Room authentication -----
        case "join_room": {
          log(clientId, "join_room — code:", msg.code);

          if (!msg.code || typeof msg.code !== "string") {
            send(ws, { type: "error", message: "Room code is required." });
            return;
          }
          if (!msg.token || typeof msg.token !== "string") {
            send(ws, { type: "error", message: "Token is required." });
            return;
          }

          // Verify JWT
          let payload: { username: string; role: "doctor" | "patient" | "admin" };
          try {
            payload = verifyToken(msg.token);
          } catch {
            logError(clientId, "join_room: invalid token");
            send(ws, { type: "error", message: "Invalid or expired token." });
            return;
          }

          // Admins cannot join interpretation rooms
          if (payload.role === "admin") {
            send(ws, { type: "error", message: "Admins cannot join interpretation rooms." });
            return;
          }

          // Fetch room from Firestore
          let room;
          try {
            room = await getRoom(msg.code);
          } catch (err) {
            logError(clientId, "join_room: getRoom failed:", err instanceof Error ? err.message : err);
            send(ws, { type: "error", message: "Failed to look up room." });
            return;
          }

          if (!room) {
            send(ws, { type: "error", message: "Room not found." });
            return;
          }

          if (room.status === "closed") {
            send(ws, { type: "error", message: "Room is closed." });
            return;
          }

          // Validate the user is a participant in this room
          const isDoctor = room.doctorUsername === payload.username;
          const isPatient = room.patientUsername === payload.username;

          if (!isDoctor && !isPatient) {
            logError(clientId, "join_room: user is not a participant", payload.username, msg.code);
            send(ws, { type: "error", message: "You are not a participant in this room." });
            return;
          }

          const joiningRole = isDoctor ? "doctor" : "patient";

          log(clientId, "join_room: authenticated as", joiningRole, "in room", msg.code);

          // Register in room connections map
          const conns = getRoomConns(msg.code);

          // Handle existing connections:
          // - If stale (not OPEN), clean up
          // - If same user reconnecting, close old connection and replace
          // - If different user, reject (shouldn't happen since room validates participants)
          if (joiningRole === "doctor" && conns.doctor && conns.doctor !== ws) {
            const existingDoctorWs = conns.doctor as any;
            if (conns.doctor.readyState !== WebSocket.OPEN) {
              // Stale connection - clean it up
              log(clientId, "Replacing stale doctor connection in room", msg.code);
              conns.doctor = undefined;
            } else if (existingDoctorWs._username === payload.username) {
              // Same user reconnecting from new tab/refresh - close old, accept new
              log(clientId, "Same doctor reconnecting, closing old connection in room", msg.code);
              send(conns.doctor, { type: "error", message: "You connected from another device/tab." });
              conns.doctor.close(1000, "Replaced by new connection");
              conns.doctor = undefined;
            } else {
              // Different user - this shouldn't happen since room validates participants
              send(ws, { type: "error", message: "A doctor is already connected to this room." });
              return;
            }
          }
          if (joiningRole === "patient" && conns.patient && conns.patient !== ws) {
            const existingPatientWs = conns.patient as any;
            if (conns.patient.readyState !== WebSocket.OPEN) {
              // Stale connection - clean it up
              log(clientId, "Replacing stale patient connection in room", msg.code);
              conns.patient = undefined;
            } else if (existingPatientWs._username === payload.username) {
              // Same user reconnecting from new tab/refresh - close old, accept new
              log(clientId, "Same patient reconnecting, closing old connection in room", msg.code);
              send(conns.patient, { type: "error", message: "You connected from another device/tab." });
              conns.patient.close(1000, "Replaced by new connection");
              conns.patient = undefined;
            } else {
              // Different user - this shouldn't happen since room validates participants
              send(ws, { type: "error", message: "A patient is already connected to this room." });
              return;
            }
          }

          // Only set connection state after all guards pass
          roomCode = msg.code;
          clientRole = joiningRole;
          clientUsername = payload.username;

          // Store username on the WebSocket for reconnection detection
          (ws as any)._username = payload.username;

          if (clientRole === "doctor") {
            conns.doctor = ws;
          } else {
            conns.patient = ws;
          }

          // Acknowledge to the joining client
          send(ws, { type: "room_joined", role: clientRole, code: roomCode });

          // Start session tracking when doctor joins (typically the initiating party)
          if (clientRole === "doctor" && msg.code) {
            analytics.startSession({
              sessionId: msg.code,
              roomCode: msg.code,
              doctorUsername: payload.username,
              patientUsername: room.patientUsername || "",
              doctorLang: room.doctorLang || "en",
              patientLang: room.patientLang || "my",
            }).catch((err) => {
              logError(clientId, "Failed to start session tracking:", err);
            });
          }

          // Notify BOTH parties when they are now connected
          const peerWs = clientRole === "doctor" ? conns.patient : conns.doctor;
          if (peerWs && peerWs.readyState === WebSocket.OPEN) {
            // Tell the peer that we just joined
            send(peerWs, { type: "peer_connected" });
            // Tell the joining client that the peer is already here
            send(ws, { type: "peer_connected" });
            log(clientId, "Both parties now connected in room", roomCode);
          }

          break;
        }

        // ----- Streaming -----
        case "start_stream": {
          log(clientId, "start_stream — role:", msg.role, "doctorLang:", msg.doctorLang, "patientLang:", msg.patientLang);

          if (msg.role !== "doctor" && msg.role !== "patient") {
            logError(clientId, "Invalid role:", msg.role);
            send(ws, { type: "error", message: "Invalid role." });
            return;
          }
          if (!isValidLang(msg.doctorLang) || !isValidLang(msg.patientLang)) {
            logError(clientId, "Invalid lang:", msg.doctorLang, msg.patientLang);
            send(ws, { type: "error", message: "Invalid language selection." });
            return;
          }
          if (msg.doctorLang === msg.patientLang) {
            logError(clientId, "Same language selected");
            send(ws, { type: "error", message: "Doctor and patient must speak different languages." });
            return;
          }

          // Track streaming state for auto-reconnect
          isUserStreaming = true;
          currentStreamRole = msg.role;
          currentDoctorLang = msg.doctorLang;
          currentPatientLang = msg.patientLang;
          currentGender = msg.gender || "male";
          turnCount = 0;
          currentSegmentAudio = [];

          // Check if we can reuse existing Gemini Live session
          // Must match role AND gender (voice model depends on gender)
          const canReuseSession = liveSession &&
            liveSession.getRole() === msg.role &&
            liveSession.getGender() === currentGender &&
            liveSession.isConnected();

          if (!canReuseSession) {
            // Clean up any existing session first (frees a slot)
            cleanupLiveSession();

            if (activeLiveSessions >= MAX_LIVE_SESSIONS) {
              log(clientId, "Rejected — max live sessions reached:", activeLiveSessions);
              send(ws, { type: "error", message: "Server is busy. Please wait and try again." });
              return;
            }
          }

          // Start conversation audio storage for this room (for post-conversation processing)
          if (roomCode) {
            startConversation(roomCode, msg.doctorLang, msg.patientLang);
          }

          // Reuse existing session or create new one
          if (canReuseSession) {
            log(clientId, "Reusing existing live session");
            send(ws, { type: "stream_started", role: msg.role });
            send(ws, { type: "stream_status", status: "listening" });
            break;
          }

          // Create new Gemini Live session
          activeLiveSessions++;
          const fromLangName = getLangName(msg.role === "doctor" ? msg.doctorLang : msg.patientLang);
          const toLangName = getLangName(msg.role === "doctor" ? msg.patientLang : msg.doctorLang);
          // Adaptive log: "from {lang} {role} to {lang} {otherRole}"
          const otherRole = msg.role === "doctor" ? "patient" : "doctor";
          console.log(`[Live Agent] Session started for ${clientUsername || "unknown"} in room ${roomCode || "none"} | from ${fromLangName} ${msg.role} to ${toLangName} ${otherRole}`);
          log(clientId, "Creating LiveInterpreterSession, active sessions:", activeLiveSessions);
          liveSession = new LiveInterpreterSession(msg.role, msg.doctorLang, msg.patientLang, currentGender);
          setupLiveSessionListeners(liveSession);

          try {
            log(clientId, "Connecting to Gemini Live...");
            await liveSession.connect();
            console.log(`[Live Agent] Connected for ${clientUsername || "unknown"} (${msg.role}) - interpreting ${fromLangName} → ${toLangName}`);
            send(ws, { type: "stream_started", role: msg.role });
            send(ws, { type: "stream_status", status: "listening" });
          } catch (err) {
            const classified = classifyGeminiError(err);
            logError(clientId, "Gemini Live connect failed:", err instanceof Error ? err.message : err);
            isUserStreaming = false;
            send(ws, { type: "error", message: classified.error });
            cleanupLiveSession();
          }
          break;
        }

        // Stream audio chunks to Gemini in real-time
        case "audio_chunk": {
          if (!liveSession) break;
          const audioData = msg.audio;
          if (!audioData || audioData.length === 0) break;

          // Stream to Gemini immediately (low latency)
          liveSession.sendAudio(audioData);

          // Store for post-conversation processing
          currentSegmentAudio.push(audioData);
          break;
        }

        // ----- Speech detection from frontend (for UI feedback only) -----
        // Note: With automatic VAD enabled, Gemini handles speech detection
        // These messages are just for UI feedback and analytics
        case "speech_start": {
          log(clientId, "Speech started (frontend VAD)");
          send(ws, { type: "stream_status", status: "speech_detected" });
          turnStartTime = Date.now(); // Track timing for analytics

          // Reset turn transcription trackers for new turn
          currentTurnInputText = "";
          currentTurnOutputText = "";

          // Signal Gemini that user is speaking (MANUAL VAD mode)
          if (liveSession) {
            log(clientId, "Sending activityStart to Gemini");
            liveSession.sendActivityStart();
          }

          // Notify peer that user is speaking (UI feedback)
          if (roomCode) {
            const peerWs = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;
            if (peerWs) {
              send(peerWs, { type: "peer_activity", activity: "speaking" });
            }
          }
          break;
        }

        case "speech_end": {
          // MANUAL VAD mode: signal activity end to trigger Gemini response
          if (liveSession) {
            log(clientId, "Sending activityEnd to Gemini");
            liveSession.sendActivityEnd();
          }
          turnCount++;
          // Note: Don't reset audioChunksSentToPeer here - turn_complete needs it
          // It gets reset in turn_complete handler
          log(clientId, `Speech ended (frontend VAD) - turn #${turnCount}`);
          break;
        }

        case "stop_stream": {
          log(clientId, "stop_stream received — user explicitly stopped");

          // Store any remaining audio segment
          if (roomCode && currentStreamRole && currentSegmentAudio.length > 0) {
            const fromLang = currentStreamRole === "doctor" ? currentDoctorLang : currentPatientLang;
            const toLang = currentStreamRole === "doctor" ? currentPatientLang : currentDoctorLang;
            const combinedAudio = combineBase64Audio(currentSegmentAudio);
            addAudioSegment(roomCode, currentStreamRole, combinedAudio, fromLang || "en", toLang || "my");
            log(clientId, `Stored final segment: ${currentSegmentAudio.length} chunks`);
          }
          currentSegmentAudio = [];
          translationAudioChunks = [];

          // User explicitly stopped - clear streaming state
          isUserStreaming = false;
          currentStreamRole = null;
          currentDoctorLang = null;
          currentPatientLang = null;

          // Close the Gemini Live session immediately to stop processing
          // This prevents random noise/silence from being transcribed
          cleanupLiveSession();

          send(ws, { type: "stream_status", status: "idle" });
          send(ws, { type: "stream_ended" });

          // Clear peer speaking indicator
          if (roomCode) {
            const peerWsForStop = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;
            if (peerWsForStop) {
              send(peerWsForStop, { type: "peer_activity", activity: "idle" });
            }
          }
          break;
        }

        // ----- Text messages -----
        case "text_message": {
          log(clientId, "text_message — role:", msg.role, "text length:", msg.text?.length, "doctorLang:", msg.doctorLang, "patientLang:", msg.patientLang);

          if (msg.role !== "doctor" && msg.role !== "patient") {
            logError(clientId, "Invalid role:", msg.role);
            send(ws, { type: "error", message: "Invalid role." });
            return;
          }
          if (!isValidLang(msg.doctorLang) || !isValidLang(msg.patientLang)) {
            logError(clientId, "Invalid lang:", msg.doctorLang, msg.patientLang);
            send(ws, { type: "error", message: "Invalid language selection." });
            return;
          }
          if (msg.doctorLang === msg.patientLang) {
            logError(clientId, "Same language selected");
            send(ws, { type: "error", message: "Doctor and patient must speak different languages." });
            return;
          }
          if (!msg.text || typeof msg.text !== "string" || msg.text.length > 5000) {
            logError(clientId, "Invalid text input, length:", msg.text?.length);
            send(ws, { type: "error", message: "Invalid or too-long text input." });
            return;
          }

          if (transcripts.length >= MAX_TRANSCRIPTS_PER_CONNECTION) {
            send(ws, {
              type: "error",
              message: "Maximum transcript length reached. Please clear and start a new session.",
            });
            return;
          }

          const fromLang = msg.role === "doctor" ? msg.doctorLang : msg.patientLang;
          const toLang = msg.role === "doctor" ? msg.patientLang : msg.doctorLang;

          log(clientId, "Translating:", fromLang, "->", toLang);

          // Notify both sides that translation has started
          if (roomCode) {
            sendToRoom(roomCode, { type: "translation_started", role: msg.role });
          }

          const translationStartTime = Date.now();

          try {

            // Stream translation deltas to both sides so they see it building in real-time
            const peerWs = roomCode
              ? (clientRole === "doctor"
                  ? roomConnections.get(roomCode)?.patient
                  : roomConnections.get(roomCode)?.doctor)
              : undefined;

            const translated = await translateTextStreaming(
              msg.text,
              fromLang,
              toLang,
              (delta) => {
                // Stream deltas to the peer (receiver sees translation building)
                if (peerWs) {
                  send(peerWs, { type: "translation_delta", text: delta });
                }
              }
            );

            log(clientId, "Translation complete, length:", translated.length);

            // Track translation analytics (NO PHI - prompts/responses not stored for HIPAA)
            const translationEndTime = Date.now();
            analytics.trackGeminiCall({
              userId: clientUsername || clientId,
              sessionId: roomCode || clientId,
              roomCode: roomCode || undefined,
              operation: "translate_text",
              agent: "gemini-2.5-flash",
              model: "gemini-2.5-flash",
              inputTokens: estimateTokens(msg.text, fromLang),
              outputTokens: estimateTokens(translated, toLang),
              latencyMs: translationEndTime - translationStartTime,
              inputType: "text",
              inputSizeBytes: Buffer.byteLength(msg.text, "utf8"),
              fromLang,
              toLang,
              success: true,
              toolsUsed: ["translation"],
            });

            const entry: TranscriptEntry = {
              id: crypto.randomUUID(),
              role: msg.role,
              original: msg.text,
              translated,
              originalLang: fromLang,
              translatedLang: toLang,
              timestamp: Date.now(),
            };

            transcripts.push(entry);

            // Broadcast final transcript to both room participants
            if (roomCode) {
              sendToRoom(roomCode, { type: "transcript", entry });
              saveTranscript(roomCode, entry).catch((err: unknown) => {
                logError(clientId, "Failed to persist transcript:", err instanceof Error ? err.message : err);
              });
            } else {
              send(ws, { type: "transcript", entry });
            }

            log(clientId, "Generating TTS for translated text...");
            try {
              const ttsStartTime = Date.now();
              const { audioBase64, mimeType } = await synthesizeSpeech(translated, toLang);
              const ttsEndTime = Date.now();
              log(clientId, "TTS complete, audio size:", audioBase64.length, "mime:", mimeType);

              // Track TTS analytics (NO PHI - text not stored for HIPAA)
              analytics.trackTtsCall({
                userId: clientUsername || clientId,
                sessionId: roomCode || clientId,
                roomCode: roomCode || undefined,
                charCount: translated.length,
                latencyMs: ttsEndTime - ttsStartTime,
                lang: toLang,
                isNeural: true,
                isGeminiFallback: toLang === "lo", // Lao uses Gemini fallback
                success: true,
              });

              // TTS audio goes to the PEER (receiver) so they hear the translation
              // The sender typed in their language, peer hears it in their language
              if (roomCode && peerWs) {
                send(peerWs, {
                  type: "audio_response",
                  audio: audioBase64,
                  mimeType,
                });
              } else {
                // Fallback: send to sender if no room/peer
                send(ws, {
                  type: "audio_response",
                  audio: audioBase64,
                  mimeType,
                });
              }
            } catch (ttsErr) {
              logError(clientId, "TTS error:", ttsErr instanceof Error ? ttsErr.message : ttsErr);
              // Track TTS error (NO PHI - text not stored for HIPAA)
              analytics.trackTtsCall({
                userId: clientUsername || clientId,
                sessionId: roomCode || clientId,
                roomCode: roomCode || undefined,
                charCount: translated.length,
                latencyMs: 0,
                lang: toLang,
                isNeural: true,
                isGeminiFallback: false,
                success: false,
                errorMessage: ttsErr instanceof Error ? ttsErr.message : String(ttsErr),
              });
            }
          } catch (err) {
            const classified = classifyGeminiError(err);
            logError(clientId, "Translation error:", err instanceof Error ? err.message : err);
            logError(clientId, "Classified:", classified);

            // Track translation error (NO PHI - prompts not stored for HIPAA)
            analytics.trackGeminiCall({
              userId: clientUsername || clientId,
              sessionId: roomCode || clientId,
              roomCode: roomCode || undefined,
              operation: "translate_text",
              agent: "gemini-2.5-flash",
              model: "gemini-2.5-flash",
              inputTokens: estimateTokens(msg.text, fromLang),
              outputTokens: 0,
              latencyMs: Date.now() - translationStartTime,
              inputType: "text",
              inputSizeBytes: Buffer.byteLength(msg.text, "utf8"),
              fromLang,
              toLang,
              success: false,
              errorMessage: err instanceof Error ? err.message : String(err),
              toolsUsed: ["translation"],
            });

            send(ws, { type: "error", message: classified.error });
          }
          break;
        }

        // ----- Peer activity relay -----
        case "peer_activity": {
          if (!roomCode) return;
          const activity = msg.activity;
          if (!["typing", "idle"].includes(activity)) return;

          // Relay to the other party only
          const peerWsForActivity = clientRole === "doctor"
            ? roomConnections.get(roomCode)?.patient
            : roomConnections.get(roomCode)?.doctor;
          if (peerWsForActivity) {
            send(peerWsForActivity, {
              type: "peer_activity",
              activity: activity === "typing" ? "typing" : "idle",
            });
          }
          break;
        }

        // ----- Image analysis -----
        case "image_analysis": {
          log(clientId, "image_analysis — role:", msg.role, "mimeType:", msg.mimeType, "description:", msg.description?.slice(0, 50));

          if (msg.role !== "doctor" && msg.role !== "patient") {
            send(ws, { type: "error", message: "Invalid role." });
            return;
          }
          if (!isValidLang(msg.doctorLang) || !isValidLang(msg.patientLang)) {
            send(ws, { type: "error", message: "Invalid language selection." });
            return;
          }
          if (!msg.imageBase64 || typeof msg.imageBase64 !== "string") {
            send(ws, { type: "error", message: "No image provided." });
            return;
          }

          // Validate mime type — accept all common image formats including iPhone (HEIC/HEIF)
          const allowedMimes = [
            "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
            "image/gif", "image/bmp", "image/tiff", "image/avif", "image/svg+xml",
          ];
          if (!msg.mimeType || !allowedMimes.includes(msg.mimeType)) {
            send(ws, { type: "error", message: "Unsupported image format." });
            return;
          }

          // Limit image size (~4MB base64 ≈ 3MB binary)
          if (msg.imageBase64.length > 4 * 1024 * 1024) {
            send(ws, { type: "error", message: "Image too large. Please use a smaller image (under 3MB)." });
            return;
          }

          const doctorLangName = getLangName(msg.doctorLang);
          const patientLangName = getLangName(msg.patientLang);
          const descriptionNote = msg.description
            ? `\n\nPatient's description of the issue:\n<DATA field="description">${sanitizeForPrompt(msg.description, 500)}</DATA>`
            : "";

          // Notify peer that image analysis is in progress
          if (roomCode) {
            const peerWsForImage = clientRole === "doctor"
              ? roomConnections.get(roomCode)?.patient
              : roomConnections.get(roomCode)?.doctor;
            if (peerWsForImage) {
              send(peerWsForImage, { type: "peer_activity", activity: "analyzing_image" });
            }
          }

          const imagePrompt = `You are a medical visual assessment assistant. A ${msg.role === "patient" ? "patient" : "doctor"} has shared an image for clinical assessment.${descriptionNote}

Analyze the image and provide a structured medical assessment for the doctor. This is to assist — NOT replace — clinical judgment.

IMPORTANT RULES:
- Be factual and objective about what you observe
- List possible conditions in order of likelihood
- Always note that in-person examination is required
- If the image is unclear, not medical, or inappropriate, say so
- Do NOT provide a definitive diagnosis
- Respond in ${doctorLangName} (the doctor's language)

Respond in this exact JSON format:
{
  "observations": "Detailed description of what is visible in the image — color, size, location, texture, pattern, etc.",
  "possibleConditions": ["Most likely condition", "Second possibility", "Third possibility"],
  "severity": "low" | "moderate" | "high" | "unknown",
  "imageQuality": "clear" | "unclear" | "insufficient",
  "recommendations": "Suggested next steps for the doctor — what to examine, tests to consider, urgency level",
  "disclaimer": "This is an AI-assisted preliminary visual assessment only. It is NOT a diagnosis. In-person clinical examination, patient history, and appropriate diagnostic tests are required for accurate diagnosis and treatment."
}

CRITICAL:
- If the image is too blurry, dark, or unclear to assess, set imageQuality to "insufficient", possibleConditions to an EMPTY array, and severity to "unknown"
- Do NOT list conditions you are not confident about — an empty possibleConditions array is better than a wrong guess
- Do NOT fabricate specific medical terms for what you observe — describe in plain language if uncertain`;

          try {
            const imageAnalysisStartTime = Date.now();
            const response = await withTimeout(
              genai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        inlineData: {
                          mimeType: msg.mimeType,
                          data: msg.imageBase64,
                        },
                      },
                      { text: imagePrompt },
                    ],
                  },
                ],
                config: {
                  responseMimeType: "application/json",
                  temperature: 0.2,
                },
              }),
              30_000,
              "imageAnalysis"
            );

            const text = response.text || "{}";
            let result: ImageAnalysisResult;

            try {
              const parsed = JSON.parse(text);
              result = {
                observations: parsed.observations || "Unable to analyze.",
                possibleConditions: Array.isArray(parsed.possibleConditions)
                  ? parsed.possibleConditions.slice(0, 5)
                  : [],
                severity: ["low", "moderate", "high", "unknown"].includes(parsed.severity)
                  ? parsed.severity
                  : "unknown",
                imageQuality: ["clear", "unclear", "insufficient"].includes(parsed.imageQuality)
                  ? parsed.imageQuality
                  : "unclear",
                recommendations: parsed.recommendations || "Please examine the patient in person.",
                disclaimer: parsed.disclaimer || "AI-assisted assessment only. Not a diagnosis.",
              };
            } catch {
              logError(clientId, "Failed to parse image analysis JSON:", text.slice(0, 200));
              send(ws, { type: "error", message: "Failed to analyze image. Please try again." });
              return;
            }

            log(clientId, "Image analysis complete, severity:", result.severity, "conditions:", result.possibleConditions.length);

            // Track image analysis analytics (NO PHI - prompts/responses not stored for HIPAA)
            const imageAnalysisEndTime = Date.now();
            const imageEventId = analytics.trackGeminiCall({
              userId: clientUsername || clientId,
              sessionId: roomCode || clientId,
              roomCode: roomCode || undefined,
              operation: "image_analysis",
              agent: "gemini-2.5-flash",
              model: "gemini-2.5-flash",
              inputTokens: response.usageMetadata?.promptTokenCount || 1000,
              outputTokens: response.usageMetadata?.candidatesTokenCount || 200,
              latencyMs: imageAnalysisEndTime - imageAnalysisStartTime,
              inputType: "image",
              inputSizeBytes: Math.round(msg.imageBase64.length * 0.75), // Base64 to binary
              fromLang: msg.doctorLang,
              toLang: msg.patientLang,
              success: true,
              toolsUsed: ["image_analysis"],
              metadata: {
                severity: result.severity,
                conditionsCount: result.possibleConditions.length,
                imageQuality: result.imageQuality,
              },
            });

            // Store image for tracking (async, don't await)
            analytics.trackImage({
              userId: clientUsername || clientId,
              sessionId: roomCode || clientId,
              roomCode: roomCode || undefined,
              imageBase64: msg.imageBase64,
              mimeType: msg.mimeType,
              purpose: "medical_image",
              analysisEventId: imageEventId,
            }).catch((err) => {
              logError(clientId, "Failed to track image:", err);
            });

            // Truncate image to a small preview (~50KB) to avoid huge WS frames
            const MAX_PREVIEW_BASE64 = 65_536; // ~48KB decoded
            const previewBase64 = msg.imageBase64.length > MAX_PREVIEW_BASE64
              ? msg.imageBase64.slice(0, MAX_PREVIEW_BASE64)
              : msg.imageBase64;
            const imagePreview = `data:${msg.mimeType};base64,${previewBase64}`;

            // Send to both room participants
            const analysisMsg: WSServerMessage = {
              type: "image_analysis_result",
              result,
              senderRole: msg.role,
              imagePreview,
            };

            if (roomCode) {
              sendToRoom(roomCode, analysisMsg);
            } else {
              send(ws, analysisMsg);
            }
          } catch (err) {
            const classified = classifyGeminiError(err);
            logError(clientId, "Image analysis error:", err instanceof Error ? err.message : err);
            send(ws, { type: "error", message: classified.error });
          }
          break;
        }

        // ----- Share certificate with both parties -----
        case "share_certificate": {
          log(clientId, "share_certificate — sharing certificate with room");

          if (!roomCode) {
            send(ws, { type: "error", message: "Not in a room." });
            return;
          }

          // Only doctor can share certificates
          if (clientRole !== "doctor") {
            send(ws, { type: "error", message: "Only doctors can share certificates." });
            return;
          }

          if (!msg.certificate || !msg.certificate.patientName) {
            send(ws, { type: "error", message: "Invalid certificate data." });
            return;
          }

          // Broadcast certificate to BOTH parties
          log(clientId, `Broadcasting certificate to room ${roomCode}`);
          sendToRoom(roomCode, {
            type: "certificate_shared",
            certificate: msg.certificate,
          });
          break;
        }

        // ----- Update patient language -----
        case "update_language": {
          log(clientId, "update_language — patientLang:", msg.patientLang);

          if (!roomCode) {
            send(ws, { type: "error", message: "Not in a room." });
            return;
          }

          // Only patient can update their language
          if (clientRole !== "patient") {
            send(ws, { type: "error", message: "Only patients can update their language." });
            return;
          }

          if (!isValidLang(msg.patientLang)) {
            send(ws, { type: "error", message: "Invalid language." });
            return;
          }

          // Notify the doctor about the language change
          sendToRoom(roomCode, {
            type: "peer_language_update",
            patientLang: msg.patientLang,
          }, ws); // Exclude sender

          log(clientId, `Notified peer about language change to ${msg.patientLang}`);
          break;
        }

        // ----- End conversation and get summary -----
        case "end_conversation": {
          log(clientId, "end_conversation — generating summary from translated audio");

          if (!roomCode) {
            send(ws, { type: "error", message: "Not in a room." });
            return;
          }

          // Get existing transcripts from Firestore (already saved during conversation via turn_complete)
          const existingTranscripts = await getTranscriptsForRoom(roomCode);

          if (existingTranscripts.length === 0) {
            send(ws, {
              type: "conversation_summary",
              summary: null,
              message: "No conversation to summarize.",
            });
            // Clear any stored audio segments
            clearConversation(roomCode);
            return;
          }

          log(clientId, `Found ${existingTranscripts.length} transcripts for summary generation`);

          // Notify both parties that processing has started
          sendToRoom(roomCode, { type: "processing_summary" });

          try {
            // Get room languages for summary generation
            const room = await getRoom(roomCode);
            const doctorLang = room?.doctorLang || "en";
            const patientLang = room?.patientLang || "my";

            // ========== NEW: Extract and combine translated audio ==========
            // Filter transcripts with translated audio URLs and sort by timestamp (oldest first)
            const transcriptsWithAudio = existingTranscripts
              .filter((t) => t.translatedAudioUrl)
              .sort((a, b) => a.timestamp - b.timestamp);

            log(clientId, `Found ${transcriptsWithAudio.length} transcripts with translated audio`);

            let conversationText = "";
            let transcribedSegments: { role: string; text: string; timestamp: number }[] = [];

            if (transcriptsWithAudio.length > 0) {
              // Download all translated audio and combine them
              const audioBuffers: Buffer[] = [];
              const segmentInfo: { role: "doctor" | "patient"; startByte: number; endByte: number; timestamp: number }[] = [];
              let currentByte = 0;

              for (const transcript of transcriptsWithAudio) {
                // Parse the audio URL to get transcriptId
                // URL format: /api/rooms/{roomCode}/audio/{transcriptId}/translated
                const urlParts = transcript.translatedAudioUrl!.split("/");
                const transcriptId = urlParts[urlParts.length - 2];

                try {
                  const audioData = await getTranscriptAudio(roomCode, transcriptId, "translated");
                  if (audioData) {
                    const startByte = currentByte;
                    audioBuffers.push(audioData.buffer);
                    currentByte += audioData.buffer.length;
                    segmentInfo.push({
                      role: transcript.role,
                      startByte,
                      endByte: currentByte,
                      timestamp: transcript.timestamp,
                    });
                    log(clientId, `Downloaded audio for transcript ${transcriptId}: ${Math.round(audioData.buffer.length / 1024)}KB`);
                  }
                } catch (err) {
                  logError(clientId, `Failed to download audio for ${transcriptId}:`, err);
                }
              }

              if (audioBuffers.length > 0) {
                // Combine all audio buffers
                const combinedAudio = Buffer.concat(audioBuffers);
                const combinedBase64 = combinedAudio.toString("base64");
                log(clientId, `Combined audio: ${Math.round(combinedAudio.length / 1024)}KB from ${audioBuffers.length} segments`);

                // Transcribe with STT V2 Chirp 3 (auto language detection)
                try {
                  const sttSegments = await transcribeConversationAudio(combinedBase64, [doctorLang, patientLang]);
                  log(clientId, `STT Chirp3 returned ${sttSegments.length} segments`);

                  // Map STT segments to roles based on timing
                  // Each STT segment has startTime/endTime in seconds, convert to bytes for matching
                  // PCM 16-bit mono at 24kHz = 48000 bytes per second (translated audio is 24kHz)
                  const BYTES_PER_SECOND = 48000;

                  for (const sttSeg of sttSegments) {
                    if (!sttSeg.text) continue;

                    // Find which role this segment belongs to based on byte position
                    const segStartByte = (sttSeg.startTime || 0) * BYTES_PER_SECOND;
                    let matchedRole: "doctor" | "patient" = "doctor";
                    let matchedTimestamp = Date.now();

                    for (const info of segmentInfo) {
                      if (segStartByte >= info.startByte && segStartByte < info.endByte) {
                        matchedRole = info.role;
                        matchedTimestamp = info.timestamp;
                        break;
                      }
                    }

                    transcribedSegments.push({
                      role: matchedRole,
                      text: sttSeg.text,
                      timestamp: matchedTimestamp,
                    });
                  }

                  // Build conversation text from transcribed segments
                  conversationText = transcribedSegments
                    .map((seg) => `${seg.role.toUpperCase()}: ${seg.text}`)
                    .join("\n");

                  log(clientId, `Transcribed conversation: ${conversationText.slice(0, 300)}...`);
                } catch (sttErr) {
                  logError(clientId, "STT Chirp3 transcription failed:", sttErr);
                  // Fall back to existing transcripts
                  conversationText = existingTranscripts
                    .filter((t) => t.translated && t.translated.trim().length > 0)
                    .map((t) => `${t.role.toUpperCase()}: ${t.translated}`)
                    .join("\n");
                }
              }
            }

            // Fallback: if no audio transcription, use existing text transcripts
            if (!conversationText || conversationText.trim().length < 20) {
              log(clientId, "No audio transcription available, falling back to existing transcripts");
              conversationText = existingTranscripts
                .filter((t) => (t.translated && t.translated.trim().length > 0) || (t.original && t.original.trim().length > 0))
                .map((t) => `${t.role.toUpperCase()}: ${t.translated || t.original}`)
                .join("\n");
            }

            let doctorSummary = "";
            let patientSummary = "";

            if (conversationText && conversationText.trim().length > 10) {
              log(clientId, `Generating summary from: ${conversationText.slice(0, 200)}...`);

              // Generate summaries in both languages
              try {
                doctorSummary = await summarizeConversation(conversationText, doctorLang);
                log(clientId, `Doctor summary: "${doctorSummary.slice(0, 100)}..."`);
              } catch (err) {
                logError(clientId, "Error generating doctor summary:", err);
                doctorSummary = "Summary generation failed";
              }

              try {
                patientSummary = await summarizeConversation(conversationText, patientLang);
                log(clientId, `Patient summary: "${patientSummary.slice(0, 100)}..."`);
              } catch (err) {
                logError(clientId, "Error generating patient summary:", err);
                patientSummary = "Summary generation failed";
              }
            } else {
              // No meaningful content to summarize
              log(clientId, "No meaningful conversation content - skipping summary generation");
              doctorSummary = `Audio consultation completed. ${existingTranscripts.length} voice messages exchanged.`;
              patientSummary = `Audio consultation completed. ${existingTranscripts.length} voice messages exchanged.`;
            }

            // Calculate duration from transcripts
            const firstTimestamp = existingTranscripts[0]?.timestamp || Date.now();
            const lastTimestamp = existingTranscripts[existingTranscripts.length - 1]?.timestamp || Date.now();
            const durationMinutes = Math.max(1, Math.round((lastTimestamp - firstTimestamp) / 60000));

            // Format transcripts as segments for the response
            // Use transcribed segments if available, otherwise use existing transcripts
            const segments = transcribedSegments.length > 0
              ? transcribedSegments.map((seg, idx) => ({
                  role: seg.role as "doctor" | "patient",
                  original: seg.text,
                  translated: seg.text, // Already in target language from translated audio
                  originalLang: seg.role === "doctor" ? patientLang : doctorLang, // Translated audio is in the listener's language
                  translatedLang: seg.role === "doctor" ? patientLang : doctorLang,
                  timestamp: seg.timestamp,
                }))
              : existingTranscripts.map((t) => ({
                  role: t.role,
                  original: t.original,
                  translated: t.translated,
                  originalLang: t.originalLang,
                  translatedLang: t.translatedLang,
                  timestamp: t.timestamp,
                }));

            // Send summary to both parties
            const doctorWs = roomConnections.get(roomCode)?.doctor;
            const patientWs = roomConnections.get(roomCode)?.patient;

            if (doctorWs) {
              send(doctorWs, {
                type: "conversation_summary",
                summary: {
                  segments,
                  summary: doctorSummary,
                  durationMinutes,
                },
              });
            }

            if (patientWs) {
              send(patientWs, {
                type: "conversation_summary",
                summary: {
                  segments,
                  summary: patientSummary,
                  durationMinutes,
                },
              });
            }

            log(clientId, `Sent summary: ${segments.length} segments, ${durationMinutes} min`);

            // Clear the stored audio (no longer needed since we used existing transcripts)
            clearConversation(roomCode);
          } catch (err) {
            logError(clientId, "Error generating summary:", err);
            send(ws, {
              type: "error",
              message: "Failed to generate summary. Please try again.",
            });
          }
          break;
        }

        default:
          logError(clientId, "Unknown message type:", (msg as any).type);
          break;
      }
    }

    ws.on("message", (data: Buffer) => {
      let msg: WSClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        logError(clientId, "Invalid JSON received");
        send(ws, { type: "error", message: "Invalid message format." });
        return;
      }

      function handleError(err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : "";
        logError(clientId, "Unhandled error in handleMessage:", errMsg);
        logError(clientId, "Stack:", errStack);
        send(ws, {
          type: "error",
          message: `An unexpected error occurred: ${errMsg.slice(0, 200)}`,
        });
      }

      if (msg.type === "text_message" || msg.type === "image_analysis" || msg.type === "peer_activity") {
        // Text messages and image analysis run concurrently — don't block other inputs
        handleMessage(data).catch(handleError);
      } else {
        // Stream messages (start/stop/audio) and join_room run serialized
        streamQueue = streamQueue
          .then(() => handleMessage(data))
          .catch(handleError);
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      log(clientId, "Disconnected, code:", code, "reason:", reason.toString());
      wsRateLimiter.remove(clientId);
      cleanupLiveSession();

      // Notify the peer and remove from room registry
      if (roomCode) {
        sendToRoom(roomCode, { type: "peer_disconnected" }, ws);
        removeFromRoom(roomCode, ws);
        log(clientId, "Removed from room", roomCode);

        // End session tracking when room is empty
        const conns = roomConnections.get(roomCode);
        if (!conns || (!conns.doctor && !conns.patient)) {
          analytics.endSession(roomCode, "completed").catch((err) => {
            logError(clientId, "Failed to end session tracking:", err);
          });
        }
      }

      // Clear transcripts to free PHI from memory
      transcripts.length = 0;
    });

    ws.on("error", (err: Error) => {
      logError(clientId, "Socket error:", err.message);
    });
  });

  console.log("WebSocket server ready at /ws/interpret");
}
