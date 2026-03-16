import { Firestore, Timestamp } from "@google-cloud/firestore";
import bcrypt from "bcryptjs";
import type { TranscriptEntry, DoctorProfile, PatientProfile, Gender } from "../types";

// ----- Types -----

export type UserRole = "doctor" | "patient" | "admin";
export type RoomStatus = "waiting" | "active" | "closed";

export interface UserDoc {
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Timestamp;
  // Profile fields
  displayName?: string;
  gender?: Gender;
  // Doctor-specific
  specialty?: string;
  hospital?: string;
  department?: string;
  licenseNumber?: string;
  languages?: string[];
  // Patient-specific
  dateOfBirth?: string;
  nationality?: string;
  idNumber?: string;       // ID or passport number
  bloodType?: string;
  height?: string;
  weight?: string;
  bloodPressure?: string;
  allergies?: string[];
  currentMedications?: string[];
  medicalConditions?: string[];
  emergencyContact?: string;
}

export interface UserPublic {
  username: string;
  role: UserRole;
  displayName?: string;
  gender?: Gender;
  createdAt: Timestamp;
  // Doctor profile fields (included for auto-fill)
  specialty?: string;
  hospital?: string;
  department?: string;
  licenseNumber?: string;
}

export interface RoomDoc {
  code: string;
  doctorUsername: string | null;
  patientUsername: string | null;
  doctorLang: string;
  patientLang: string;
  status: RoomStatus;
  createdAt: Timestamp;
  // Generated summary (bilingual)
  summary?: {
    summaryLang1: string;
    summaryLang2: string;
    lang1Label: string;
    lang2Label: string;
    generatedAt: Timestamp;
  };
  // Generated certificate (bilingual)
  certificate?: {
    certificateLang1: import("../types").CertificateContent;
    certificateLang2: import("../types").CertificateContent;
    lang1Label: string;
    lang2Label: string;
    generatedAt: Timestamp;
  };
}

// ----- In-Memory Store (for local dev without GCP credentials) -----

const USE_MEMORY_STORE = process.env.USE_MEMORY_STORE === "true";

interface MemoryStore {
  users: Map<string, UserDoc>;
  rooms: Map<string, RoomDoc>;
  transcripts: Map<string, TranscriptEntry[]>;
}

const memoryStore: MemoryStore = {
  users: new Map(),
  rooms: new Map(),
  transcripts: new Map(),
};

// Seed default test users for memory store (matches LoginPage.tsx test accounts)
async function seedMemoryStore() {
  const testUsers: Array<Partial<UserDoc> & { password: string }> = [
    { username: "admin", password: "admin123", role: "admin" as const, displayName: "System Admin", gender: "male" as const },
    // Doctors with profile info (all at SoeMind Hospital)
    {
      username: "dr_smith", password: "doctor123", role: "doctor" as const,
      displayName: "Dr. John Smith",
      gender: "male" as const,
      specialty: "General Practice",
      hospital: "SoeMind Hospital",
      department: "Internal Medicine",
      licenseNumber: "SM-12345",
      languages: ["en", "th"],
    },
    {
      username: "dr_chen", password: "doctor123", role: "doctor" as const,
      displayName: "Dr. Wei Chen",
      gender: "male" as const,
      specialty: "Cardiology",
      hospital: "SoeMind Hospital",
      department: "Cardiology",
      licenseNumber: "SM-23456",
      languages: ["zh", "en", "th"],
    },
    {
      username: "dr_tanaka", password: "doctor123", role: "doctor" as const,
      displayName: "Dr. Yuki Tanaka",
      gender: "female" as const,
      specialty: "Pediatrics",
      hospital: "SoeMind Hospital",
      department: "Pediatrics",
      licenseNumber: "SM-34567",
      languages: ["en", "th"],
    },
    {
      username: "dr_wong", password: "doctor123", role: "doctor" as const,
      displayName: "Dr. Lisa Wong",
      gender: "female" as const,
      specialty: "Dermatology",
      hospital: "SoeMind Hospital",
      department: "Dermatology",
      licenseNumber: "SM-45678",
      languages: ["zh", "en"],
    },
    // Patients with medical info (including vitals)
    {
      username: "patient_aung", password: "patient123", role: "patient" as const,
      displayName: "Aung Kyaw",
      gender: "male" as const,
      dateOfBirth: "1985-03-15",
      nationality: "Myanmar",
      idNumber: "12/MA GA NA(N)123456",
      bloodType: "O+",
      height: "168 cm",
      weight: "72 kg",
      bloodPressure: "130/85 mmHg",
      allergies: ["Penicillin"],
      currentMedications: ["Metformin 500mg"],
      medicalConditions: ["Type 2 Diabetes"],
      emergencyContact: "+95 9 123 456 789",
    },
    {
      username: "patient_thida", password: "patient123", role: "patient" as const,
      displayName: "Thida Win",
      gender: "female" as const,
      dateOfBirth: "1992-07-22",
      nationality: "Myanmar",
      idNumber: "12/THA MA NA(N)789012",
      bloodType: "A+",
      height: "155 cm",
      weight: "52 kg",
      bloodPressure: "110/70 mmHg",
      allergies: [],
      currentMedications: [],
      medicalConditions: [],
      emergencyContact: "+95 9 987 654 321",
    },
    {
      username: "patient_zaw", password: "patient123", role: "patient" as const,
      displayName: "Zaw Min",
      gender: "male" as const,
      dateOfBirth: "1978-11-08",
      nationality: "Myanmar",
      idNumber: "12/YA KA NA(N)345678",
      bloodType: "B+",
      height: "175 cm",
      weight: "85 kg",
      bloodPressure: "145/95 mmHg",
      allergies: ["Sulfa drugs", "Aspirin"],
      currentMedications: ["Lisinopril 10mg", "Atorvastatin 20mg"],
      medicalConditions: ["Hypertension", "High Cholesterol"],
      emergencyContact: "+95 9 555 123 456",
    },
    {
      username: "patient_hla", password: "patient123", role: "patient" as const,
      displayName: "Hla Myint",
      gender: "female" as const,
      dateOfBirth: "2001-04-30",
      nationality: "Myanmar",
      idNumber: "12/MA BA NA(N)901234",
      bloodType: "AB+",
      height: "160 cm",
      weight: "58 kg",
      bloodPressure: "115/75 mmHg",
      allergies: [],
      currentMedications: [],
      medicalConditions: ["Asthma"],
      emergencyContact: "+95 9 444 789 012",
    },
    {
      username: "patient_kyaw", password: "patient123", role: "patient" as const,
      displayName: "Kyaw Soe",
      gender: "male" as const,
      dateOfBirth: "1965-09-12",
      nationality: "Myanmar",
      idNumber: "12/KA MA NA(N)567890",
      bloodType: "O-",
      height: "172 cm",
      weight: "78 kg",
      bloodPressure: "125/80 mmHg",
      allergies: ["Ibuprofen"],
      currentMedications: ["Insulin", "Metoprolol 25mg"],
      medicalConditions: ["Type 1 Diabetes", "Heart Disease"],
      emergencyContact: "+95 9 333 456 789",
    },
  ];

  for (const user of testUsers) {
    if (!memoryStore.users.has(user.username!)) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const { password, ...userData } = user;
      memoryStore.users.set(user.username!, {
        ...userData,
        username: user.username!,
        passwordHash,
        role: user.role!,
        createdAt: Timestamp.now(),
      } as UserDoc);
    }
  }
  console.log(`[Firestore] Memory store seeded with ${testUsers.length} test users`);
}

// ----- Firestore connection (lazy init to avoid crash) -----

let db: Firestore | null = null;
let firestoreAvailable = false;

async function getDb(): Promise<Firestore | null> {
  if (USE_MEMORY_STORE) return null;

  if (db === null) {
    try {
      db = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        ignoreUndefinedProperties: true,
      });
      // Test connection
      await db.collection("_health").limit(1).get();
      firestoreAvailable = true;
      console.log("[Firestore] Connected to Firestore");
    } catch (err) {
      console.warn("[Firestore] Not available, using in-memory store");
      console.warn("[Firestore] To use Firestore, run: gcloud auth application-default login");
      db = null;
      firestoreAvailable = false;
      await seedMemoryStore();
    }
  }
  return db;
}

// Initialize on module load
if (USE_MEMORY_STORE) {
  console.log("[Firestore] Using in-memory store (USE_MEMORY_STORE=true)");
  seedMemoryStore();
}

// ----- Helpers -----

function generateRoomCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

// ----- User functions -----

export async function createUser(
  username: string,
  password: string,
  role: UserRole
): Promise<UserPublic> {
  const database = await getDb();

  if (!database) {
    // Memory store
    if (memoryStore.users.has(username)) {
      throw new Error("USERNAME_EXISTS");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const now = Timestamp.now();
    memoryStore.users.set(username, { username, passwordHash, role, createdAt: now });
    return { username, role, createdAt: now };
  }

  // Firestore
  const usersCol = database.collection("users");
  const existing = await usersCol.where("username", "==", username).limit(1).get();

  if (!existing.empty) {
    throw new Error("USERNAME_EXISTS");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = Timestamp.now();
  const doc: UserDoc = { username, passwordHash, role, createdAt: now };
  await usersCol.add(doc);

  return { username, role, createdAt: now };
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<UserPublic> {
  const database = await getDb();

  if (!database) {
    // Memory store
    const user = memoryStore.users.get(username);
    if (!user) {
      await bcrypt.compare(password, "$2a$12$invalidhashfortimingatk000000000000000000000000000000000");
      throw new Error("INVALID_CREDENTIALS");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error("INVALID_CREDENTIALS");
    }
    return {
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      gender: user.gender,
      createdAt: user.createdAt,
      // Include doctor profile fields for auto-fill
      specialty: user.specialty,
      hospital: user.hospital,
      department: user.department,
      licenseNumber: user.licenseNumber,
    };
  }

  // Firestore
  const usersCol = database.collection("users");
  const snapshot = await usersCol.where("username", "==", username).limit(1).get();

  if (snapshot.empty) {
    await bcrypt.compare(password, "$2a$12$invalidhashfortimingatk000000000000000000000000000000000");
    throw new Error("INVALID_CREDENTIALS");
  }

  const data = snapshot.docs[0].data() as UserDoc;
  const valid = await bcrypt.compare(password, data.passwordHash);

  if (!valid) {
    throw new Error("INVALID_CREDENTIALS");
  }

  return {
    username: data.username,
    role: data.role,
    displayName: data.displayName,
    gender: data.gender,
    createdAt: data.createdAt,
    // Include doctor profile fields for auto-fill
    specialty: data.specialty,
    hospital: data.hospital,
    department: data.department,
    licenseNumber: data.licenseNumber,
  };
}

// ----- Room functions -----

export async function createRoom(
  doctorUsername: string,
  doctorLang: string,
  patientLang: string
): Promise<RoomDoc> {
  const database = await getDb();

  if (!database) {
    // Memory store
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      const existing = Array.from(memoryStore.rooms.values()).find(
        r => r.code === code && (r.status === "waiting" || r.status === "active")
      );
      if (!existing) {
        const room: RoomDoc = {
          code,
          doctorUsername,
          patientUsername: null,
          doctorLang,
          patientLang,
          status: "waiting",
          createdAt: Timestamp.now(),
        };
        memoryStore.rooms.set(code, room);
        return room;
      }
    }
    throw new Error("ROOM_CODE_GENERATION_FAILED");
  }

  // Firestore
  const roomsCol = database.collection("rooms");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const existing = await roomsCol
      .where("code", "==", code)
      .where("status", "in", ["waiting", "active"])
      .limit(1)
      .get();

    if (!existing.empty) continue;

    const room: RoomDoc = {
      code,
      doctorUsername,
      patientUsername: null,
      doctorLang,
      patientLang,
      status: "waiting",
      createdAt: Timestamp.now(),
    };
    await roomsCol.add(room);
    return room;
  }

  throw new Error("ROOM_CODE_GENERATION_FAILED");
}

export async function joinRoom(
  code: string,
  patientUsername: string,
  patientLang: string
): Promise<RoomDoc> {
  const database = await getDb();

  if (!database) {
    // Memory store
    const room = memoryStore.rooms.get(code);
    if (!room || room.status !== "waiting") {
      throw new Error("ROOM_NOT_FOUND");
    }
    if (room.patientUsername !== null) {
      throw new Error("ROOM_FULL");
    }
    room.patientUsername = patientUsername;
    room.patientLang = patientLang;
    room.status = "active";
    return room;
  }

  // Firestore
  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol
    .where("code", "==", code)
    .where("status", "==", "waiting")
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error("ROOM_NOT_FOUND");
  }

  const docRef = snapshot.docs[0].ref;
  const data = snapshot.docs[0].data() as RoomDoc;

  if (data.patientUsername !== null) {
    throw new Error("ROOM_FULL");
  }

  const updated: Partial<RoomDoc> = { patientUsername, patientLang, status: "active" };
  await docRef.update(updated);

  return { ...data, ...updated };
}

export async function getRoom(code: string): Promise<RoomDoc | null> {
  const database = await getDb();

  if (!database) {
    return memoryStore.rooms.get(code) || null;
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as RoomDoc;
}

export async function closeRoom(code: string): Promise<void> {
  const database = await getDb();

  if (!database) {
    const room = memoryStore.rooms.get(code);
    if (room) room.status = "closed";
    return;
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", code).limit(1).get();
  if (snapshot.empty) return;
  await snapshot.docs[0].ref.update({ status: "closed" } satisfies Partial<RoomDoc>);
}

/**
 * Save generated summary to room document
 */
export async function saveRoomSummary(
  code: string,
  summary: {
    summaryLang1: string;
    summaryLang2: string;
    lang1Label: string;
    lang2Label: string;
  }
): Promise<void> {
  const database = await getDb();

  if (!database) {
    const room = memoryStore.rooms.get(code);
    if (room) {
      (room as any).summary = {
        ...summary,
        generatedAt: Timestamp.now(),
      };
    }
    return;
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", code).limit(1).get();
  if (snapshot.empty) return;
  await snapshot.docs[0].ref.update({
    summary: {
      ...summary,
      generatedAt: Timestamp.now(),
    },
  });
}

/**
 * Save generated certificate to room document
 */
export async function saveRoomCertificate(
  code: string,
  certificate: {
    certificateLang1: import("../types").CertificateContent;
    certificateLang2: import("../types").CertificateContent;
    lang1Label: string;
    lang2Label: string;
  }
): Promise<void> {
  const database = await getDb();

  if (!database) {
    const room = memoryStore.rooms.get(code);
    if (room) {
      (room as any).certificate = {
        ...certificate,
        generatedAt: Timestamp.now(),
      };
    }
    return;
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", code).limit(1).get();
  if (snapshot.empty) return;
  await snapshot.docs[0].ref.update({
    certificate: {
      ...certificate,
      generatedAt: Timestamp.now(),
    },
  });
}

/**
 * Get room summary if exists
 */
export async function getRoomSummary(code: string): Promise<RoomDoc["summary"] | null> {
  const room = await getRoom(code);
  return room?.summary || null;
}

/**
 * Get room certificate if exists
 */
export async function getRoomCertificate(code: string): Promise<RoomDoc["certificate"] | null> {
  const room = await getRoom(code);
  return room?.certificate || null;
}

export async function saveTranscript(
  roomCode: string,
  entry: TranscriptEntry
): Promise<void> {
  const database = await getDb();

  if (!database) {
    const transcripts = memoryStore.transcripts.get(roomCode) || [];
    // Update existing or add new
    const existingIdx = transcripts.findIndex(t => t.id === entry.id);
    if (existingIdx >= 0) {
      transcripts[existingIdx] = { ...transcripts[existingIdx], ...entry };
    } else {
      transcripts.push(entry);
    }
    memoryStore.transcripts.set(roomCode, transcripts);
    return;
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", roomCode).limit(1).get();
  if (snapshot.empty) {
    console.warn("[Firestore] saveTranscript: room not found for code:", roomCode);
    return;
  }

  // Use transcript ID as document ID so we can update with audio URLs later
  await snapshot.docs[0].ref.collection("transcripts").doc(entry.id).set({
    ...entry,
    savedAt: Timestamp.now(),
  }, { merge: true });
}

export async function getTranscriptsForRoom(roomCode: string): Promise<TranscriptEntry[]> {
  const database = await getDb();

  if (!database) {
    return memoryStore.transcripts.get(roomCode) || [];
  }

  const roomsCol = database.collection("rooms");
  const snapshot = await roomsCol.where("code", "==", roomCode).limit(1).get();
  if (snapshot.empty) return [];

  const transcriptsSnapshot = await snapshot.docs[0].ref
    .collection("transcripts")
    .orderBy("timestamp", "asc")
    .get();

  return transcriptsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: data.id,
      role: data.role,
      original: data.original,
      translated: data.translated,
      originalLang: data.originalLang,
      translatedLang: data.translatedLang,
      timestamp: data.timestamp,
      // Include audio URLs if present
      ...(data.originalAudioUrl && { originalAudioUrl: data.originalAudioUrl }),
      ...(data.translatedAudioUrl && { translatedAudioUrl: data.translatedAudioUrl }),
    } as TranscriptEntry;
  });
}

export async function getActiveRoomsForUser(
  username: string,
  role: "doctor" | "patient"
): Promise<RoomDoc[]> {
  const database = await getDb();

  if (!database) {
    // Memory store - filter rooms where user is a participant and status is active/waiting
    const rooms: RoomDoc[] = [];
    for (const room of memoryStore.rooms.values()) {
      if (room.status === "closed") continue;
      if (role === "doctor" && room.doctorUsername === username) {
        rooms.push(room);
      } else if (role === "patient" && room.patientUsername === username) {
        rooms.push(room);
      }
    }
    return rooms;
  }

  const roomsCol = database.collection("rooms");
  const field = role === "doctor" ? "doctorUsername" : "patientUsername";
  const snapshot = await roomsCol
    .where(field, "==", username)
    .where("status", "in", ["waiting", "active"])
    .get();

  return snapshot.docs.map((doc) => doc.data() as RoomDoc);
}

// ----- User profile functions -----

export async function getDoctorProfile(username: string): Promise<DoctorProfile | null> {
  const database = await getDb();

  if (!database) {
    const user = memoryStore.users.get(username);
    if (!user || user.role !== "doctor") return null;
    return {
      username: user.username,
      displayName: user.displayName || user.username,
      gender: user.gender,
      specialty: user.specialty,
      hospital: user.hospital,
      department: user.department,
      licenseNumber: user.licenseNumber,
      languages: user.languages,
    };
  }

  const usersCol = database.collection("users");
  const snapshot = await usersCol
    .where("username", "==", username)
    .where("role", "==", "doctor")
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const data = snapshot.docs[0].data() as UserDoc;
  return {
    username: data.username,
    displayName: data.displayName || data.username,
    gender: data.gender,
    specialty: data.specialty,
    hospital: data.hospital,
    department: data.department,
    licenseNumber: data.licenseNumber,
    languages: data.languages,
  };
}

export async function getPatientProfile(username: string): Promise<PatientProfile | null> {
  const database = await getDb();

  if (!database) {
    const user = memoryStore.users.get(username);
    if (!user || user.role !== "patient") return null;
    return {
      username: user.username,
      displayName: user.displayName || user.username,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      nationality: user.nationality,
      idNumber: user.idNumber,
      bloodType: user.bloodType,
      height: user.height,
      weight: user.weight,
      bloodPressure: user.bloodPressure,
      allergies: user.allergies,
      currentMedications: user.currentMedications,
      medicalConditions: user.medicalConditions,
      emergencyContact: user.emergencyContact,
    };
  }

  const usersCol = database.collection("users");
  const snapshot = await usersCol
    .where("username", "==", username)
    .where("role", "==", "patient")
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const data = snapshot.docs[0].data() as UserDoc;
  return {
    username: data.username,
    displayName: data.displayName || data.username,
    gender: data.gender,
    dateOfBirth: data.dateOfBirth,
    nationality: data.nationality,
    idNumber: data.idNumber,
    bloodType: data.bloodType,
    height: data.height,
    weight: data.weight,
    bloodPressure: data.bloodPressure,
    allergies: data.allergies,
    currentMedications: data.currentMedications,
    medicalConditions: data.medicalConditions,
    emergencyContact: data.emergencyContact,
  };
}

/**
 * Get session history for a user
 */
export async function getSessionHistory(
  username: string,
  role: "doctor" | "patient"
): Promise<Array<{
  id: string;
  roomCode: string;
  date: string;
  doctorName: string;
  patientName: string;
  duration: string;
  status: "completed" | "active" | "abandoned";
  hasCertificate: boolean;
}>> {
  const database = await getDb();

  // If using memory store, return empty for now
  if (!database) {
    return [];
  }

  const roomsRef = database.collection("rooms");

  // Query rooms where user is participant
  // Note: Using where without orderBy to avoid composite index requirement
  const fieldName = role === "doctor" ? "doctorUsername" : "patientUsername";
  const snapshot = await roomsRef
    .where(fieldName, "==", username)
    .get();

  const sessions = await Promise.all(
    snapshot.docs.map(async (doc: FirebaseFirestore.DocumentSnapshot) => {
      const data = doc.data() || {};

      // Get display names
      let doctorName = data.doctorUsername || "Doctor";
      let patientName = data.patientUsername || "Patient";

      if (data.doctorUsername) {
        const doctorProfile = await getDoctorProfile(data.doctorUsername);
        if (doctorProfile?.displayName) {
          doctorName = doctorProfile.displayName;
        }
      }

      if (data.patientUsername) {
        const patientProfile = await getPatientProfile(data.patientUsername);
        if (patientProfile?.displayName) {
          patientName = patientProfile.displayName;
        }
      }

      // Calculate duration
      let duration = "Unknown";
      if (data.createdAt && data.closedAt) {
        const start = data.createdAt.toDate();
        const end = data.closedAt.toDate();
        const mins = Math.round((end.getTime() - start.getTime()) / 60000);
        duration = mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} hr`;
      } else if (data.createdAt) {
        duration = "In progress";
      }

      // Format date
      let date = "";
      if (data.createdAt) {
        const d = data.createdAt.toDate();
        date = d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      // Determine status
      const status: "completed" | "active" | "abandoned" =
        data.status === "closed" ? "completed" :
        data.status === "active" ? "active" : "abandoned";

      return {
        id: doc.id,
        roomCode: String(data.code || doc.id),
        date,
        doctorName: String(doctorName),
        patientName: String(patientName),
        duration,
        status,
        hasCertificate: !!data.certificate,
        createdAtMs: data.createdAt?.toDate?.()?.getTime?.() || 0,
      };
    })
  );

  // Sort by createdAt descending and limit to 50
  return sessions
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 50)
    .map(({ createdAtMs, ...rest }) => rest);
}
