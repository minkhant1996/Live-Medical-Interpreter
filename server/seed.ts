/**
 * Seed Firestore with test users
 * Run: npx tsx seed.ts
 */

import { Firestore, Timestamp } from "@google-cloud/firestore";
import bcrypt from "bcryptjs";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "dev-hack-mar-2026";

const db = new Firestore({ projectId: PROJECT_ID });

interface UserDoc {
  username: string;
  passwordHash: string;
  role: "doctor" | "patient" | "admin";
  createdAt: Timestamp;
  displayName?: string;
  specialty?: string;
  hospital?: string;
  department?: string;
  licenseNumber?: string;
  dateOfBirth?: string;
  bloodType?: string;
  height?: string;
  weight?: string;
  bloodPressure?: string;
  allergies?: string[];
  currentMedications?: string[];
  medicalConditions?: string[];
  emergencyContact?: string;
}

async function seed() {
  console.log(`Seeding Firestore in project: ${PROJECT_ID}`);

  const usersCol = db.collection("users");

  // Check if already seeded
  const existing = await usersCol.limit(1).get();
  if (!existing.empty) {
    console.log("Database already has users. Skipping seed.");
    console.log("To re-seed, delete the users collection first.");
    return;
  }

  const now = Timestamp.now();
  const doctorHash = await bcrypt.hash("doctor123", 12);
  const patientHash = await bcrypt.hash("patient123", 12);
  const adminHash = await bcrypt.hash("admin123", 12);

  const users: UserDoc[] = [
    // Admin
    {
      username: "admin",
      passwordHash: adminHash,
      role: "admin",
      displayName: "System Admin",
      createdAt: now,
    },
    // Doctors (all at SoeMind Hospital)
    {
      username: "dr_smith",
      passwordHash: doctorHash,
      role: "doctor",
      displayName: "Dr. James Smith",
      specialty: "General Practice",
      hospital: "SoeMind Hospital",
      department: "General Medicine",
      licenseNumber: "SM-12345",
      createdAt: now,
    },
    {
      username: "dr_chen",
      passwordHash: doctorHash,
      role: "doctor",
      displayName: "Dr. Emily Chen",
      specialty: "Pediatrics",
      hospital: "SoeMind Hospital",
      department: "Pediatric Care",
      licenseNumber: "SM-23456",
      createdAt: now,
    },
    {
      username: "dr_tanaka",
      passwordHash: doctorHash,
      role: "doctor",
      displayName: "Dr. Yuki Tanaka",
      specialty: "Cardiology",
      hospital: "SoeMind Hospital",
      department: "Heart Center",
      licenseNumber: "SM-34567",
      createdAt: now,
    },
    {
      username: "dr_wong",
      passwordHash: doctorHash,
      role: "doctor",
      displayName: "Dr. Michael Wong",
      specialty: "Orthopedics",
      hospital: "SoeMind Hospital",
      department: "Bone & Joint",
      licenseNumber: "SM-45678",
      createdAt: now,
    },
    // Patients
    {
      username: "patient_aung",
      passwordHash: patientHash,
      role: "patient",
      displayName: "Aung Kyaw Moe",
      dateOfBirth: "1985-03-15",
      bloodType: "O+",
      height: "168 cm",
      weight: "72 kg",
      bloodPressure: "130/85 mmHg",
      allergies: ["Penicillin"],
      currentMedications: ["Metformin 500mg"],
      medicalConditions: ["Type 2 Diabetes"],
      emergencyContact: "+66 81 234 5678",
      createdAt: now,
    },
    {
      username: "patient_thida",
      passwordHash: patientHash,
      role: "patient",
      displayName: "Thida Win",
      dateOfBirth: "1990-07-22",
      bloodType: "A+",
      height: "155 cm",
      weight: "52 kg",
      bloodPressure: "110/70 mmHg",
      allergies: [],
      currentMedications: [],
      medicalConditions: [],
      emergencyContact: "+66 82 345 6789",
      createdAt: now,
    },
    {
      username: "patient_zaw",
      passwordHash: patientHash,
      role: "patient",
      displayName: "Zaw Min Oo",
      dateOfBirth: "1978-11-08",
      bloodType: "B+",
      height: "175 cm",
      weight: "85 kg",
      bloodPressure: "145/95 mmHg",
      allergies: ["Sulfa drugs", "Aspirin"],
      currentMedications: ["Lisinopril 10mg", "Atorvastatin 20mg"],
      medicalConditions: ["Hypertension", "High Cholesterol"],
      emergencyContact: "+66 83 456 7890",
      createdAt: now,
    },
    {
      username: "patient_hla",
      passwordHash: patientHash,
      role: "patient",
      displayName: "Hla Hla Myint",
      dateOfBirth: "1995-01-30",
      bloodType: "AB+",
      height: "160 cm",
      weight: "58 kg",
      bloodPressure: "115/75 mmHg",
      allergies: [],
      currentMedications: ["Omeprazole 20mg"],
      medicalConditions: ["GERD"],
      emergencyContact: "+66 84 567 8901",
      createdAt: now,
    },
    {
      username: "patient_kyaw",
      passwordHash: patientHash,
      role: "patient",
      displayName: "Kyaw Soe Lin",
      dateOfBirth: "1982-09-12",
      bloodType: "O-",
      height: "172 cm",
      weight: "78 kg",
      bloodPressure: "125/80 mmHg",
      allergies: ["Latex"],
      currentMedications: [],
      medicalConditions: [],
      emergencyContact: "+66 85 678 9012",
      createdAt: now,
    },
  ];

  console.log(`Adding ${users.length} users...`);

  const batch = db.batch();
  for (const user of users) {
    const docRef = usersCol.doc(user.username);
    batch.set(docRef, user);
  }

  await batch.commit();
  console.log("✅ Seed complete! Test accounts:");
  console.log("   Doctors: dr_smith, dr_chen, dr_tanaka, dr_wong (password: doctor123)");
  console.log("   Patients: patient_aung, patient_thida, patient_zaw, patient_hla, patient_kyaw (password: patient123)");
  console.log("   Admin: admin (password: admin123)");
}

seed().catch(console.error);
