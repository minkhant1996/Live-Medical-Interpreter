import { Router } from "express";
import type { Request, Response } from "express";
import { createRoom, joinRoom, getRoom, getActiveRoomsForUser, getTranscriptsForRoom, closeRoom, getDoctorProfile, getPatientProfile, saveRoomSummary, saveRoomCertificate, getRoomSummary, getRoomCertificate } from "../services/firestore";
import { requireAuth } from "../middleware/auth";
import { isValidLang } from "../services/gemini";
import { getTranscriptAudio } from "../services/audioStorage";

export const roomsRouter = Router();

// All room routes require a valid JWT
roomsRouter.use(requireAuth);

// ----- POST /api/rooms/create -----
// Only doctors may create a room.

roomsRouter.post("/create", async (req: Request, res: Response) => {
  const user = req.user!; // guaranteed by requireAuth

  if (user.role !== "doctor") {
    res.status(403).json({
      error: "Only doctors can create rooms.",
      code: "FORBIDDEN",
    });
    return;
  }

  const { doctorLang } = req.body as {
    doctorLang?: unknown;
  };

  if (typeof doctorLang !== "string" || !isValidLang(doctorLang)) {
    res.status(400).json({
      error: "Invalid doctorLang.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    // Patient will set their language when joining
    const room = await createRoom(user.username, doctorLang, "");
    res.status(201).json({ code: room.code, room });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] create error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to create room. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- POST /api/rooms/join -----
// Only patients may join a room.

roomsRouter.post("/join", async (req: Request, res: Response) => {
  const user = req.user!;

  if (user.role !== "patient") {
    res.status(403).json({
      error: "Only patients can join rooms.",
      code: "FORBIDDEN",
    });
    return;
  }

  const { code, patientLang } = req.body as { code?: unknown; patientLang?: unknown };

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    res.status(400).json({
      error: "Room code must be a 6-digit number.",
      code: "INVALID_INPUT",
    });
    return;
  }

  if (typeof patientLang !== "string" || !isValidLang(patientLang)) {
    res.status(400).json({
      error: "Please select your language.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const room = await joinRoom(code, user.username, patientLang);
    res.json({ room });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === "ROOM_NOT_FOUND") {
      res.status(404).json({
        error: "Room not found or no longer accepting participants.",
        code: "ROOM_NOT_FOUND",
      });
      return;
    }

    if (message === "ROOM_FULL") {
      res.status(409).json({
        error: "Room already has a patient.",
        code: "ROOM_FULL",
      });
      return;
    }

    console.error("[rooms] join error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to join room. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// =====================================================
// IMPORTANT: Fixed-path routes MUST come before /:code
// =====================================================

// ----- GET /api/rooms/active/me -----
// Get active rooms for the current user (with participant display names)

roomsRouter.get("/active/me", async (req: Request, res: Response) => {
  const user = req.user!;

  if (user.role === "admin") {
    res.json({ rooms: [] });
    return;
  }

  try {
    const rooms = await getActiveRoomsForUser(user.username, user.role as "doctor" | "patient");

    // Enrich rooms with participant display names
    const enrichedRooms = await Promise.all(
      rooms.map(async (room) => {
        let doctorDisplayName: string | null = null;
        let patientDisplayName: string | null = null;

        if (room.doctorUsername) {
          const doctorProfile = await getDoctorProfile(room.doctorUsername);
          doctorDisplayName = doctorProfile?.displayName || room.doctorUsername;
        }

        if (room.patientUsername) {
          const patientProfile = await getPatientProfile(room.patientUsername);
          patientDisplayName = patientProfile?.displayName || room.patientUsername;
        }

        // Return explicit fields to avoid Firestore Timestamp serialization issues
        return {
          code: room.code,
          doctorUsername: room.doctorUsername,
          patientUsername: room.patientUsername,
          doctorLang: room.doctorLang,
          patientLang: room.patientLang,
          status: room.status,
          doctorDisplayName,
          patientDisplayName,
        };
      })
    );

    res.json({ rooms: enrichedRooms });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] active/me error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch active rooms.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/history -----
// Get session history for the current user

roomsRouter.get("/history", async (req: Request, res: Response) => {
  const user = req.user!;

  if (user.role === "admin") {
    res.json({ sessions: [] });
    return;
  }

  try {
    // Import getSessionHistory from firestore
    const { getSessionHistory } = await import("../services/firestore");
    const sessions = await getSessionHistory(user.username, user.role as "doctor" | "patient");
    res.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] history error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch session history.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/preview/:code -----
// Preview a room before joining (for patients)
// Returns room info and doctor profile WITHOUT joining

roomsRouter.get("/preview/:code", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (user.role !== "patient") {
    res.status(403).json({
      error: "Only patients can preview rooms.",
      code: "FORBIDDEN",
    });
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      error: "Room code must be a 6-digit number.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const room = await getRoom(code);

    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    if (room.status === "closed") {
      res.status(410).json({ error: "This session has ended.", code: "ROOM_CLOSED" });
      return;
    }

    if (room.status === "active" && room.patientUsername && room.patientUsername !== user.username) {
      res.status(409).json({ error: "This room already has a patient.", code: "ROOM_FULL" });
      return;
    }

    // Get doctor profile for the preview
    let doctorProfile = null;
    if (room.doctorUsername) {
      doctorProfile = await getDoctorProfile(room.doctorUsername);
    }

    res.json({
      room: {
        code: room.code,
        doctorLang: room.doctorLang,
        patientLang: room.patientLang,
        status: room.status,
        doctorUsername: room.doctorUsername,
      },
      doctorProfile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] preview error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch room. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// =====================================================
// Parameterized routes come AFTER fixed-path routes
// =====================================================

// ----- GET /api/rooms/:code -----
// Any authenticated participant may fetch a room.

roomsRouter.get("/:code", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      error: "Room code must be a 6-digit number.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const room = await getRoom(code);

    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only participants in the room may view it
    const isParticipant =
      room.doctorUsername === user.username ||
      room.patientUsername === user.username;

    if (!isParticipant) {
      res.status(403).json({
        error: "You are not a participant in this room.",
        code: "FORBIDDEN",
      });
      return;
    }

    res.json({ room });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] get error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch room. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/:code/transcripts -----
// Get transcripts for a room

roomsRouter.get("/:code/transcripts", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      error: "Room code must be a 6-digit number.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const room = await getRoom(code);

    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only participants in the room may view transcripts
    const isParticipant =
      room.doctorUsername === user.username ||
      room.patientUsername === user.username;

    if (!isParticipant) {
      res.status(403).json({
        error: "You are not a participant in this room.",
        code: "FORBIDDEN",
      });
      return;
    }

    const transcripts = await getTranscriptsForRoom(code);
    res.json({ transcripts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] transcripts error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch transcripts.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/:code/audio/:transcriptId/:type -----
// Serve transcript audio from GCS

roomsRouter.get("/:code/audio/:transcriptId/:type", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);
  const transcriptId = String(req.params.transcriptId);
  const type = String(req.params.type) as "original" | "translated";

  if (!["original", "translated"].includes(type)) {
    res.status(400).json({ error: "Invalid audio type." });
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room not found." });
      return;
    }

    // Verify user is a participant
    const isParticipant = room.doctorUsername === user.username || room.patientUsername === user.username;
    if (!isParticipant && user.role !== "admin") {
      res.status(403).json({ error: "You are not a participant in this room." });
      return;
    }

    const audioData = await getTranscriptAudio(code, transcriptId, type);
    if (!audioData) {
      res.status(404).json({ error: "Audio not found." });
      return;
    }

    res.setHeader("Content-Type", audioData.mimeType);
    res.setHeader("Content-Length", audioData.buffer.length);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(audioData.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] audio error:", message.slice(0, 200));
    res.status(500).json({ error: "Failed to fetch audio." });
  }
});

// ----- POST /api/rooms/:code/end -----
// End a room session (doctor only)

roomsRouter.post("/:code/end", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);
  console.log(`[rooms] POST /${code}/end - closing room for doctor ${user.username}`);

  if (user.role !== "doctor") {
    res.status(403).json({
      error: "Only doctors can end sessions.",
      code: "FORBIDDEN",
    });
    return;
  }

  try {
    const room = await getRoom(code);

    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    if (room.doctorUsername !== user.username) {
      res.status(403).json({
        error: "You are not the doctor for this room.",
        code: "FORBIDDEN",
      });
      return;
    }

    await closeRoom(code);
    console.log(`[rooms] Room ${code} closed successfully`);
    res.json({ success: true, message: "Session ended." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] end error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to end session.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/:code/participant-profile -----
// Get the other participant's profile for a room
// Doctor sees patient profile, patient sees doctor profile

roomsRouter.get("/:code/participant-profile", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({
      error: "Room code must be a 6-digit number.",
      code: "INVALID_INPUT",
    });
    return;
  }

  try {
    const room = await getRoom(code);

    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only participants in the room may view profiles
    const isDoctor = room.doctorUsername === user.username;
    const isPatient = room.patientUsername === user.username;

    if (!isDoctor && !isPatient) {
      res.status(403).json({
        error: "You are not a participant in this room.",
        code: "FORBIDDEN",
      });
      return;
    }

    // Doctor sees patient profile, patient sees doctor profile
    if (isDoctor) {
      if (!room.patientUsername) {
        res.json({ profile: null, role: "patient" });
        return;
      }
      const profile = await getPatientProfile(room.patientUsername);
      res.json({ profile, role: "patient" });
    } else {
      if (!room.doctorUsername) {
        res.json({ profile: null, role: "doctor" });
        return;
      }
      const profile = await getDoctorProfile(room.doctorUsername);
      res.json({ profile, role: "doctor" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rooms] participant-profile error:", message.slice(0, 200));
    res.status(500).json({
      error: "Failed to fetch profile.",
      code: "INTERNAL_ERROR",
    });
  }
});

// ----- GET /api/rooms/:code/summary -----
// Get saved summary for a room
roomsRouter.get("/:code/summary", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid room code.", code: "INVALID_INPUT" });
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only participants can view
    if (room.doctorUsername !== user.username && room.patientUsername !== user.username) {
      res.status(403).json({ error: "Access denied.", code: "FORBIDDEN" });
      return;
    }

    const summary = await getRoomSummary(code);
    res.json({ summary });
  } catch (err) {
    console.error("[rooms] get summary error:", err);
    res.status(500).json({ error: "Failed to get summary.", code: "INTERNAL_ERROR" });
  }
});

// ----- POST /api/rooms/:code/summary -----
// Save summary to room (doctor only)
roomsRouter.post("/:code/summary", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid room code.", code: "INVALID_INPUT" });
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only doctor can save summary
    if (room.doctorUsername !== user.username) {
      res.status(403).json({ error: "Only the doctor can save summary.", code: "FORBIDDEN" });
      return;
    }

    const { summaryLang1, summaryLang2, lang1Label, lang2Label } = req.body;
    if (!summaryLang1 || !summaryLang2 || !lang1Label || !lang2Label) {
      res.status(400).json({ error: "Missing summary data.", code: "INVALID_INPUT" });
      return;
    }

    await saveRoomSummary(code, { summaryLang1, summaryLang2, lang1Label, lang2Label });
    res.json({ success: true });
  } catch (err) {
    console.error("[rooms] save summary error:", err);
    res.status(500).json({ error: "Failed to save summary.", code: "INTERNAL_ERROR" });
  }
});

// ----- GET /api/rooms/:code/certificate -----
// Get saved certificate for a room
roomsRouter.get("/:code/certificate", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid room code.", code: "INVALID_INPUT" });
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only participants can view
    if (room.doctorUsername !== user.username && room.patientUsername !== user.username) {
      res.status(403).json({ error: "Access denied.", code: "FORBIDDEN" });
      return;
    }

    const certificate = await getRoomCertificate(code);
    res.json({ certificate });
  } catch (err) {
    console.error("[rooms] get certificate error:", err);
    res.status(500).json({ error: "Failed to get certificate.", code: "INTERNAL_ERROR" });
  }
});

// ----- POST /api/rooms/:code/certificate -----
// Save certificate to room (doctor only)
roomsRouter.post("/:code/certificate", async (req: Request, res: Response) => {
  const user = req.user!;
  const code = String(req.params.code);

  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid room code.", code: "INVALID_INPUT" });
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room not found.", code: "ROOM_NOT_FOUND" });
      return;
    }

    // Only doctor can save certificate
    if (room.doctorUsername !== user.username) {
      res.status(403).json({ error: "Only the doctor can save certificate.", code: "FORBIDDEN" });
      return;
    }

    const { certificateLang1, certificateLang2, lang1Label, lang2Label } = req.body;
    if (!certificateLang1 || !certificateLang2 || !lang1Label || !lang2Label) {
      res.status(400).json({ error: "Missing certificate data.", code: "INVALID_INPUT" });
      return;
    }

    await saveRoomCertificate(code, { certificateLang1, certificateLang2, lang1Label, lang2Label });
    res.json({ success: true });
  } catch (err) {
    console.error("[rooms] save certificate error:", err);
    res.status(500).json({ error: "Failed to save certificate.", code: "INTERNAL_ERROR" });
  }
});
