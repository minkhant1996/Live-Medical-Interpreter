/**
 * Migration: Add gender to existing users
 *
 * Usage:
 *   npx tsx scripts/migrate-gender.ts
 */

import "dotenv/config";
import { Firestore } from "@google-cloud/firestore";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
if (!PROJECT_ID) {
  console.error("❌ GOOGLE_CLOUD_PROJECT environment variable is required");
  process.exit(1);
}
console.log(`Using project: ${PROJECT_ID}`);

const db = new Firestore({
  projectId: PROJECT_ID,
  ignoreUndefinedProperties: true,
});

// Gender mapping for existing users
const GENDER_MAP: Record<string, "male" | "female"> = {
  // Admin
  "admin": "male",
  // Doctors
  "dr_smith": "male",
  "dr_chen": "female",
  "dr_tanaka": "female",
  "dr_wong": "male",
  // Patients
  "patient_aung": "male",
  "patient_thida": "female",
  "patient_zaw": "male",
  "patient_hla": "female",
  "patient_kyaw": "male",
};

async function migrate() {
  console.log("🔄 Migrating gender field to existing users...\n");

  const usersCol = db.collection("users");
  const snapshot = await usersCol.get();

  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const username = data.username as string;

    // Check if gender is already set
    if (data.gender) {
      console.log(`⏭️  ${username} - already has gender: ${data.gender}`);
      skipped++;
      continue;
    }

    // Get gender from mapping
    const gender = GENDER_MAP[username];
    if (!gender) {
      console.log(`⚠️  ${username} - not in mapping, skipping`);
      skipped++;
      continue;
    }

    // Update user
    await doc.ref.update({ gender });
    console.log(`✅ ${username} - set gender to: ${gender}`);
    updated++;
  }

  console.log(`\n📊 Migration complete: ${updated} updated, ${skipped} skipped`);
}

migrate().catch(console.error);
