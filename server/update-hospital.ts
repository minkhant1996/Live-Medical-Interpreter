/**
 * Update all doctors to use SoeMind Hospital
 * Run: npx tsx update-hospital.ts
 */

import { Firestore } from "@google-cloud/firestore";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "dev-hack-mar-2026";
const db = new Firestore({ projectId: PROJECT_ID });

async function updateHospital() {
  console.log(`Updating doctors in project: ${PROJECT_ID}`);

  const usersCol = db.collection("users");
  const doctors = await usersCol.where("role", "==", "doctor").get();

  if (doctors.empty) {
    console.log("No doctors found.");
    return;
  }

  const batch = db.batch();
  let count = 0;

  for (const doc of doctors.docs) {
    const data = doc.data();
    const oldHospital = data.hospital;

    // Update to SoeMind Hospital and SM- license prefix
    batch.update(doc.ref, {
      hospital: "SoeMind Hospital",
      licenseNumber: data.licenseNumber?.replace(/^TH-/, "SM-") || data.licenseNumber,
    });

    console.log(`  ${data.displayName}: ${oldHospital} → SoeMind Hospital`);
    count++;
  }

  await batch.commit();
  console.log(`\n✅ Updated ${count} doctors to SoeMind Hospital`);
}

updateHospital().catch(console.error);
