export type SupportedLang = "en" | "th" | "my" | "km" | "lo" | "vi" | "zh";

// User profile types
export type Gender = "male" | "female";

export interface DoctorProfile {
  username: string;
  displayName: string;
  gender?: Gender;
  specialty?: string;
  hospital?: string;
  department?: string;
  licenseNumber?: string;
  languages?: string[];
}

export interface PatientProfile {
  username: string;
  displayName: string;
  gender?: Gender;
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

export interface TranscriptEntry {
  id: string;
  role: "doctor" | "patient";
  original: string;
  translated: string;
  originalLang: string;
  translatedLang: string;
  timestamp: number;
  // Audio URLs (for persistence/refresh)
  originalAudioUrl?: string;
  translatedAudioUrl?: string;
  // Inline audio (for real-time display, not persisted)
  audioBase64?: string;
  audioMimeType?: string;
}

export interface SessionState {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
}

export interface SummaryRequest {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
}

export interface SummaryResponse {
  summaryLang1: string;
  summaryLang2: string;
  lang1Label: string;
  lang2Label: string;
}

export interface CertificateRequest {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  patientInfo: {
    name: string;
    age: string;
    sex: string;
  };
  doctorInfo: {
    name: string;
    licenseNumber: string;
    hospital: string;
    department: string;
  };
  visitDate: string;
  visitType: "outpatient" | "inpatient";
}

export interface CertificateResponse {
  certificateLang1: CertificateContent;
  certificateLang2: CertificateContent;
  lang1Label: string;
  lang2Label: string;
}

export interface CertificateContent {
  title: string;
  patientName: string;
  patientAge: string;
  patientSex: string;
  visitDate: string;
  visitType: string;
  chiefComplaint: string;
  principalDiagnosis: string;
  treatments: string;
  operationProcedure: string;
  recommendations: string;
  physicianName: string;
  licenseNumber: string;
  hospital: string;
  department: string;
  disclaimer: string;
}

// WebSocket message types
export interface ImageAnalysisResult {
  observations: string;
  possibleConditions: string[];
  severity: "low" | "moderate" | "high" | "unknown";
  imageQuality: "clear" | "unclear" | "insufficient";
  recommendations: string;
  disclaimer: string;
}

// Certificate data for sharing
export interface SharedCertificateData {
  certificateHtml: string;
  patientName: string;
  doctorName: string;
  visitDate: string;
  summary: {
    chiefComplaint: string;
    diagnosis: string;
    symptoms: string[];
    medication: string[];
    doctorInstructions: string[];
    followUp: string;
  };
}

export type WSClientMessage =
  | { type: "join_room"; code: string; token: string }
  | { type: "start_stream"; role: "doctor" | "patient"; doctorLang: SupportedLang; patientLang: SupportedLang; gender?: Gender }
  | { type: "audio_chunk"; audio: string }
  | { type: "speech_start" }
  | { type: "speech_end"; audio: string }
  | { type: "stop_stream" }
  | { type: "end_conversation" }
  | { type: "text_message"; role: "doctor" | "patient"; text: string; doctorLang: SupportedLang; patientLang: SupportedLang }
  | { type: "image_analysis"; imageBase64: string; mimeType: string; role: "doctor" | "patient"; doctorLang: SupportedLang; patientLang: SupportedLang; description?: string }
  | { type: "peer_activity"; activity: "typing" | "idle" }
  | { type: "share_certificate"; certificate: SharedCertificateData }
  | { type: "update_language"; patientLang: SupportedLang };

export type StreamStatus =
  | "listening"      // Mic active, waiting for speech
  | "speech_detected" // VAD detected speech
  | "sending_to_agent" // Audio being sent to Gemini
  | "agent_processing" // Waiting for Gemini response
  | "agent_speaking"   // Gemini is speaking translation
  | "idle";           // Not streaming

// Conversation summary from post-processing
export interface ConversationSummaryData {
  segments: Array<{
    role: "doctor" | "patient";
    original: string;
    translated: string;
    originalLang: string;
    translatedLang: string;
    timestamp: number;
  }>;
  summary: string;
  durationMinutes: number;
}

export type WSServerMessage =
  | { type: "transcript"; entry: TranscriptEntry; audioBase64?: string; audioMimeType?: string }
  | { type: "translation_delta"; text: string }
  | { type: "audio_chunk"; audio: string; mimeType: string }
  | { type: "audio_response"; audio: string; mimeType: string }
  | { type: "error"; message: string }
  | { type: "stream_started"; role: "doctor" | "patient" }
  | { type: "stream_ended" }
  | { type: "interrupted" }
  | { type: "peer_connected" }
  | { type: "peer_disconnected" }
  | { type: "room_joined"; role: "doctor" | "patient"; code: string }
  | { type: "image_analysis_result"; result: ImageAnalysisResult; senderRole: "doctor" | "patient"; imagePreview: string }
  | { type: "peer_activity"; activity: "typing" | "speaking" | "processing" | "analyzing_image" | "idle" }
  | { type: "translation_started"; role: "doctor" | "patient" }
  | { type: "transcription_interim"; text: string; source: "sender" | "translation" | "peer_original" }
  | { type: "transcription_final"; text: string; source: "sender" | "translation" | "peer_original" }
  | { type: "stream_status"; status: StreamStatus }
  | { type: "processing_summary" }
  | { type: "conversation_summary"; summary: ConversationSummaryData | null; message?: string }
  | { type: "audio_message"; id: string; role: "doctor" | "patient"; audioBase64: string; mimeType: string; timestamp: number }
  | { type: "certificate_shared"; certificate: SharedCertificateData }
  | { type: "peer_language_update"; patientLang: string };
