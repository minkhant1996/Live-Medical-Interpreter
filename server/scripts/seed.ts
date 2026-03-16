/**
 * Firestore Seed Script
 * ---------------------
 * Creates collections, indexes, and mock data for local development.
 *
 * Usage:
 *   # With Firestore emulator (recommended for local dev):
 *   export FIRESTORE_EMULATOR_HOST=localhost:8080
 *   export GOOGLE_CLOUD_PROJECT=med-interpreter-dev
 *   npx tsx server/scripts/seed.ts
 *
 *   # With real Firestore (careful — writes to production!):
 *   export GOOGLE_CLOUD_PROJECT=your-project-id
 *   npx tsx server/scripts/seed.ts
 *
 *   # Flags:
 *   --clean     Wipe all collections before seeding
 *   --dry-run   Print what would be created without writing
 */

import { Firestore, Timestamp } from "@google-cloud/firestore";
import bcrypt from "bcryptjs";

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "med-interpreter-dev";
const CLEAN = process.argv.includes("--clean");
const DRY_RUN = process.argv.includes("--dry-run");

const db = new Firestore({
  projectId: PROJECT_ID,
  ignoreUndefinedProperties: true,
});

// ── Seed Data ───────────────────────────────────────────────────────────────

// 5 Patients + 4 Doctors + 1 Admin
const USERS = [
  // Admin
  { username: "admin", password: "admin123", role: "admin" as const, displayName: "System Admin", gender: "male" as const },
  // Doctors (with full profile)
  {
    username: "dr_smith", password: "doctor123", role: "doctor" as const,
    displayName: "Dr. James Smith", gender: "male" as const,
    specialty: "General Practice", hospital: "SoeMind Hospital", department: "Internal Medicine", licenseNumber: "SM-12345"
  },
  {
    username: "dr_chen", password: "doctor123", role: "doctor" as const,
    displayName: "Dr. Emily Chen", gender: "female" as const,
    specialty: "Cardiology", hospital: "SoeMind Hospital", department: "Cardiology", licenseNumber: "SM-23456"
  },
  {
    username: "dr_tanaka", password: "doctor123", role: "doctor" as const,
    displayName: "Dr. Yuki Tanaka", gender: "female" as const,
    specialty: "Pediatrics", hospital: "SoeMind Hospital", department: "Pediatrics", licenseNumber: "SM-34567"
  },
  {
    username: "dr_wong", password: "doctor123", role: "doctor" as const,
    displayName: "Dr. Michael Wong", gender: "male" as const,
    specialty: "Dermatology", hospital: "SoeMind Hospital", department: "Dermatology", licenseNumber: "SM-45678"
  },
  // 5 Patients with Burmese names (with full profile)
  {
    username: "patient_aung", password: "patient123", role: "patient" as const,
    displayName: "Aung Kyaw Moe", gender: "male" as const,
    dateOfBirth: "1985-03-15", nationality: "Myanmar", idNumber: "12/MA GA NA(N)123456",
    bloodType: "O+", height: "168 cm", weight: "72 kg", bloodPressure: "130/85 mmHg",
    allergies: ["Penicillin"], currentMedications: ["Metformin 500mg"], medicalConditions: ["Type 2 Diabetes"]
  },
  {
    username: "patient_thida", password: "patient123", role: "patient" as const,
    displayName: "Thida Win", gender: "female" as const,
    dateOfBirth: "1992-07-22", nationality: "Myanmar", idNumber: "12/THA MA NA(N)789012",
    bloodType: "A+", height: "155 cm", weight: "52 kg", bloodPressure: "110/70 mmHg",
    allergies: [], currentMedications: [], medicalConditions: []
  },
  {
    username: "patient_zaw", password: "patient123", role: "patient" as const,
    displayName: "Zaw Min Oo", gender: "male" as const,
    dateOfBirth: "1978-11-08", nationality: "Myanmar", idNumber: "12/YA KA NA(N)345678",
    bloodType: "B+", height: "175 cm", weight: "85 kg", bloodPressure: "145/95 mmHg",
    allergies: ["Sulfa drugs", "Aspirin"], currentMedications: ["Lisinopril 10mg", "Atorvastatin 20mg"], medicalConditions: ["Hypertension", "High Cholesterol"]
  },
  {
    username: "patient_hla", password: "patient123", role: "patient" as const,
    displayName: "Hla Hla Myint", gender: "female" as const,
    dateOfBirth: "2001-04-30", nationality: "Myanmar", idNumber: "12/MA BA NA(N)901234",
    bloodType: "AB+", height: "160 cm", weight: "58 kg", bloodPressure: "115/75 mmHg",
    allergies: [], currentMedications: [], medicalConditions: ["Asthma"]
  },
  {
    username: "patient_kyaw", password: "patient123", role: "patient" as const,
    displayName: "Kyaw Soe Lin", gender: "male" as const,
    dateOfBirth: "1965-09-12", nationality: "Myanmar", idNumber: "12/KA MA NA(N)567890",
    bloodType: "O-", height: "172 cm", weight: "78 kg", bloodPressure: "125/80 mmHg",
    allergies: ["Ibuprofen"], currentMedications: ["Insulin", "Metoprolol 25mg"], medicalConditions: ["Type 1 Diabetes", "Heart Disease"]
  },
];

interface RoomSeed {
  code: string;
  doctorUsername: string;
  patientUsername: string | null;
  doctorLang: string;
  patientLang: string;
  status: "waiting" | "active" | "closed";
  transcripts: {
    role: "doctor" | "patient";
    original: string;
    translated: string;
    originalLang: string;
    translatedLang: string;
  }[];
}

// 20 Medical Cases - Natural conversations
const ROOMS: RoomSeed[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 1: Aung Kyaw Moe - Fever & Cold (with Dr. Smith) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "100001",
    doctorUsername: "dr_smith",
    patientUsername: "patient_aung",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Good morning! Please have a seat. What seems to be the problem today?",
        translated: "မင်္ဂလာပါ! ထိုင်ပါ။ ဒီနေ့ ဘာဖြစ်နေပါသလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မင်္ဂလာပါ ဆရာဝန်။ ကျွန်တော် သုံးရက်လောက် ဖျားနေပါတယ်၊ ခေါင်းလည်း ကိုက်တယ်။",
        translated: "Good morning doctor. I've had a fever for about three days, and I also have a headache.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I see. Do you have any other symptoms? Like a sore throat or runny nose?",
        translated: "နားလည်ပါပြီ။ တခြား လက္ခဏာတွေ ရှိသေးလား? လည်ချောင်းနာတာ ဒါမှမဟုတ် နှာစေးတာမျိုးပေါ့?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့၊ လည်ချောင်းလည်း နာတယ်၊ ချောင်းလည်း ဆိုးတယ်။ ညဘက်ဆို ပိုဆိုးတယ်။",
        translated: "Yes, my throat hurts and I'm coughing too. It gets worse at night.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Let me check your temperature first. Have you been taking any medicine?",
        translated: "အရင်ဆုံး အပူချိန်တိုင်းကြည့်ပါရစေ။ ဆေးတစ်ခုခု သောက်ထားပါသလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ပါရာစီတမော သောက်ထားပါတယ်။ ဒါပေမယ့် ဖျားတာ မသက်သာသေးဘူး။",
        translated: "I've been taking paracetamol. But the fever hasn't gone down yet.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Your temperature is 38.5 degrees. It looks like you have the flu. I'll prescribe some medicine for you.",
        translated: "အပူချိန်က ၃၈.၅ ဒီဂရီ ရှိနေတယ်။ တုပ်ကွေးဖြစ်နေပုံပါပဲ။ ဆေးတစ်ချို့ ပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျေးဇူးပါ ဆရာဝန်။ ဆေးကို ဘယ်လိုသောက်ရမလဲ?",
        translated: "Thank you doctor. How should I take the medicine?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Take this flu medicine three times a day after meals. Also drink plenty of water and rest well.",
        translated: "ဒီတုပ်ကွေးဆေးကို ထမင်းစားပြီး တစ်နေ့ သုံးကြိမ် သောက်ပါ။ ရေလည်း အများကြီး သောက်ပြီး အနားယူပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "နားလည်ပါပြီ။ ဘယ်နှစ်ရက်လောက် သောက်ရမလဲ?",
        translated: "I understand. How many days should I take it?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Take it for 5 days. If you don't feel better after 3 days, please come back.",
        translated: "၅ ရက် သောက်ပါ။ ၃ ရက်ကြာလည်း မသက်သာသေးရင် ပြန်လာပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 2: Aung Kyaw Moe - Follow-up for Flu (with Dr. Smith) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "100002",
    doctorUsername: "dr_smith",
    patientUsername: "patient_aung",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "Welcome back! How are you feeling now? Did the medicine help?",
        translated: "ပြန်လာတာ ကြိုဆိုပါတယ်! အခု ဘယ်လိုခံစားရပါသလဲ? ဆေးက အကူအညီဖြစ်ပါသလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ အများကြီး သက်သာသွားပါပြီ။ ဖျားတာလည်း ပျောက်သွားပြီ။",
        translated: "Doctor, I feel much better now. The fever is gone.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "That's great news! Are you still coughing?",
        translated: "သတင်းကောင်းပါပဲ! ချောင်းဆိုးတာ ရှိသေးလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "နည်းနည်းတော့ ဆိုးသေးတယ်၊ ဒါပေမယ့် အရင်လောက် မဆိုးတော့ဘူး။",
        translated: "A little bit, but not as much as before.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Good. Please finish the rest of the antibiotics. The cough should go away in a few days.",
        translated: "ကောင်းပါပြီ။ ပဋိဇီဝဆေး အကုန်သောက်ပါ။ ချောင်းဆိုးတာ ရက်အနည်းငယ်အတွင်း ပျောက်သွားပါလိမ့်မယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျေးဇူးတင်ပါတယ် ဆရာဝန်။",
        translated: "Thank you, doctor.",
        originalLang: "my",
        translatedLang: "en",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 3: Thida Win - Stomach Pain (with Dr. Chen) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "200001",
    doctorUsername: "dr_chen",
    patientUsername: "patient_thida",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Hello, I'm Dr. Chen. What brings you in today?",
        translated: "မင်္ဂလာပါ၊ ကျွန်မက ဆရာဝန် ချန် ပါ။ ဒီနေ့ ဘာကြောင့် လာတာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ ကျွန်မ ဗိုက်နာနေတယ်။ ညဘက်ဆို ပိုနာတယ်။",
        translated: "Doctor, I have stomach pain. It's worse at night.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Can you point to where it hurts exactly?",
        translated: "ဘယ်နေရာမှာ အတိအကျ နာတယ်ဆိုတာ ညွှန်ပြနိုင်မလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဒီနေရာမှာပါ၊ ဗိုက်အလယ်မှာ။ ထမင်းမစားခင် ပိုနာတယ်။",
        translated: "Right here, in the middle of my stomach. It hurts more before eating.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "How long have you had this pain?",
        translated: "ဒီနာကျင်မှုကို ဘယ်လောက်ကြာပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "တစ်ပတ်လောက် ရှိပြီ။ အစပိုင်းတုန်းက နည်းနည်းပဲ၊ အခုတော့ ပိုနာလာပြီ။",
        translated: "About a week now. At first it was mild, but now it's getting worse.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Do you feel nauseous? Any vomiting?",
        translated: "အော့အန်ချင်သလို ခံစားရလား? အန်ဖူးလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အော့အန်ချင်တာ ရှိတယ်၊ ဒါပေမယ့် အန်တော့ မအန်ဖူးဘူး။",
        translated: "I feel nauseous sometimes, but I haven't vomited.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I think you might have gastritis. Let me prescribe some medicine. Also, please avoid spicy and oily food.",
        translated: "အစာအိမ်ရောင်ရမ်းတာ ဖြစ်နိုင်ပါတယ်။ ဆေးတစ်ချို့ ပေးပါမယ်။ စပ်တဲ့အစားအစာနဲ့ ဆီများတဲ့အစားအစာတွေ ရှောင်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ ဘယ်လို အစားအစာတွေ စားသင့်လဲ?",
        translated: "Yes doctor. What kind of food should I eat?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Eat soft foods like rice porridge, boiled vegetables. Eat small meals throughout the day instead of large meals.",
        translated: "ဆန်ပြုတ်၊ ပြုတ်ထားတဲ့ဟင်းသီးဟင်းရွက် လို နူးညံ့တဲ့အစားအစာတွေ စားပါ။ တစ်ကြိမ်တည်း အများကြီးစားမယ့်အစား နည်းနည်းစီ အကြိမ်ကြိမ် စားပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 4: Thida Win - Headache & Dizziness (with Dr. Wong) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "200002",
    doctorUsername: "dr_wong",
    patientUsername: "patient_thida",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Good afternoon. I see from your file you've been having headaches?",
        translated: "နေ့လည်ခင်းပါ။ မှတ်တမ်းထဲမှာ ခေါင်းကိုက်နေတယ်လို့ တွေ့ရပါတယ်?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ တစ်ပတ်လောက် ဖြစ်နေပြီ။ ခေါင်းမူးတာလည်း ရှိတယ်။",
        translated: "Yes doctor. It's been about a week. I also feel dizzy.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "When do you usually get the headaches? Morning or evening?",
        translated: "ခေါင်းကိုက်တာ ဘယ်အချိန်မှာ ဖြစ်လေ့ရှိလဲ? မနက်ပိုင်း ဒါမှမဟုတ် ညနေပိုင်း?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အများအားဖြင့် ညနေပိုင်းမှာပါ။ အလုပ်ပြီးတဲ့နောက် ပိုဆိုးတယ်။",
        translated: "Usually in the evening. It gets worse after work.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Do you work with computers a lot?",
        translated: "ကွန်ပျူတာနဲ့ အများကြီး အလုပ်လုပ်ရလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့၊ တစ်နေ့လုံးနီးပါး ကွန်ပျူတာရှေ့မှာ ထိုင်ရတယ်။",
        translated: "Yes, I sit in front of the computer almost all day.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "That could be causing eye strain headaches. Let me check your blood pressure first.",
        translated: "အဲဒါက မျက်စိပင်ပန်းမှုကြောင့် ခေါင်းကိုက်တာ ဖြစ်နိုင်တယ်။ အရင်ဆုံး သွေးပေါင်ချိန် တိုင်းကြည့်ပါရစေ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ပါ။",
        translated: "Okay.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Your blood pressure is normal. I recommend taking breaks from the computer every 30 minutes. Also, I'll prescribe some mild pain relief.",
        translated: "သွေးပေါင်ချိန် ပုံမှန်ပါပဲ။ ကွန်ပျူတာကနေ မိနစ် ၃၀ တိုင်း အနားယူဖို့ အကြံပြုပါတယ်။ နာကျင်မှု သက်သာဆေး နည်းနည်း ပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 5: Zaw Min Oo - Diabetes Check (with Dr. Chen) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "300001",
    doctorUsername: "dr_chen",
    patientUsername: "patient_zaw",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Good morning. How have you been managing your diabetes?",
        translated: "မင်္ဂလာပါ။ ဆီးချိုရောဂါ ဘယ်လို ထိန်းသိမ်းနေပါသလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ ဆေးပုံမှန် သောက်နေပါတယ်။ ဒါပေမယ့် မနေ့ညက သွေးချိုက အရမ်းမြင့်သွားတယ်။",
        translated: "Doctor, I'm taking the medicine regularly. But last night my blood sugar was very high.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "What was your reading?",
        translated: "ဘယ်လောက် ရှိတာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "၂၅၀ လောက် ရှိတယ်။ ပုံမှန်တော့ ၁၅၀ လောက်ပဲ ရှိတယ်။",
        translated: "Around 250. Usually it's only about 150.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Did you eat anything unusual yesterday?",
        translated: "မနေ့က ထူးထူးခြားခြား တစ်ခုခု စားခဲ့လား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မနေ့က မင်္ဂလာပွဲ သွားတာ။ မုန့်တွေ နည်းနည်း စားမိတယ်။",
        translated: "I went to a wedding yesterday. I ate some cake.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "That explains it. Sugar from sweets can spike your blood sugar quickly. Try to avoid sweets as much as possible.",
        translated: "အဲဒါကြောင့်ပါ။ မုန့်တွေထဲက သကြားက သွေးထဲမှာ သကြားပမာဏကို မြန်မြန်တက်စေတယ်။ အချိုစာတွေကို တတ်နိုင်သမျှ ရှောင်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ နောက်ကနေ သတိထားပါမယ်။",
        translated: "Yes doctor. I'll be more careful from now on.",
        originalLang: "my",
        translatedLang: "en",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 6: Zaw Min Oo - Foot Pain (with Dr. Tanaka) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "300002",
    doctorUsername: "dr_tanaka",
    patientUsername: "patient_zaw",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "Hello, I'm Dr. Tanaka. I understand you have foot pain?",
        translated: "မင်္ဂလာပါ၊ ကျွန်တော်က ဆရာဝန် တာနာကာ ပါ။ ခြေထောက်နာနေတယ်လို့ သိရပါတယ်?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ ခြေဖဝါးမှာ ထုံကျင်ကျင် ဖြစ်နေတယ်။ လမ်းလျှောက်ရင် ပိုနာတယ်။",
        translated: "Yes doctor. My feet feel numb and tingling. It hurts more when I walk.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I see from your records you have diabetes. This numbness could be diabetic neuropathy.",
        translated: "မှတ်တမ်းထဲမှာ ဆီးချိုရှိတယ်လို့ တွေ့ရတယ်။ ဒီထုံကျင်တာက ဆီးချိုကြောင့် အာရုံကြော ပျက်စီးတာ ဖြစ်နိုင်တယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆိုးရွားတာလား ဆရာဝန်?",
        translated: "Is it serious, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "It's important to manage your blood sugar well to prevent it from getting worse. I'll also prescribe vitamin B to help with the nerves.",
        translated: "ပိုမဆိုးသွားအောင် သွေးထဲမှာ သကြားပမာဏကို ကောင်းကောင်း ထိန်းသိမ်းဖို့ အရေးကြီးပါတယ်။ အာရုံကြောတွေအတွက် ဗီတာမင်ဘီလည်း ပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျေးဇူးပါ ဆရာဝန်။ ခြေထောက်ကို ဂရုစိုက်ရမယ့် အကြံဉာဏ် ရှိလား?",
        translated: "Thank you doctor. Do you have any advice for taking care of my feet?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Check your feet daily for cuts or sores. Wear comfortable shoes. Don't walk barefoot.",
        translated: "ခြေထောက်မှာ အနာ ဒါမှမဟုတ် ဒဏ်ရာ ရှိမရှိ နေ့တိုင်း စစ်ပါ။ သက်တောင့်သက်သာရှိတဲ့ ဖိနပ် စီးပါ။ ခြေဗလာ မလျှောက်ပါနဲ့။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 7: Hla Hla Myint - Pregnancy Check (with Dr. Chen) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "400001",
    doctorUsername: "dr_chen",
    patientUsername: "patient_hla",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Hello! How are you feeling today? Any morning sickness?",
        translated: "မင်္ဂလာပါ! ဒီနေ့ ဘယ်လိုခံစားရပါသလဲ? မနက်ပိုင်း အော့အန်တာ ရှိလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ မနက်တိုင်း အော့အန်ချင်တယ်။ အထူးသဖြင့် ဆန်ပြုတ် စားပြီးရင်။",
        translated: "Doctor, I feel nauseous every morning. Especially after eating rice porridge.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "That's normal in the first trimester. Try eating small amounts frequently instead of large meals.",
        translated: "ပထမ သုံးလပတ်မှာ ပုံမှန်ပါပဲ။ တစ်ကြိမ်တည်း အများကြီးစားမယ့်အစား နည်းနည်းစီ မကြာခဏ စားကြည့်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့။ ကလေးက ကျန်းမာနေတယ်လား ဆရာဝန်?",
        translated: "Okay. Is the baby healthy, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Let me do an ultrasound. Please lie down here.",
        translated: "ကျွန်မ ultrasound လုပ်ကြည့်ပါရစေ။ ဒီမှာ လှဲလိုက်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ပါ။",
        translated: "Okay.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "The baby looks healthy! You're about 10 weeks along. I can see the heartbeat.",
        translated: "ကလေးက ကျန်းမာပါတယ်! ၁၀ ပတ်လောက် ရှိပါပြီ။ နှလုံးခုန်သံ မြင်ရပါတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အိုး ကျေးဇူးတင်ပါတယ် ဆရာဝန်။ ဝမ်းသာလိုက်တာ။",
        translated: "Oh thank you doctor. I'm so happy.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Please continue taking your vitamins and come back in 4 weeks for your next checkup.",
        translated: "ဗီတာမင်တွေ ဆက်သောက်ပါ။ နောက် ၄ ပတ်ကြာရင် ပြန်လာပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 8: Hla Hla Myint - Back Pain (with Dr. Smith) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "400002",
    doctorUsername: "dr_smith",
    patientUsername: "patient_hla",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "I understand you've been having back pain?",
        translated: "ကျောနာနေတယ်လို့ သိရပါတယ်?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ ကိုယ်ဝန်ကြီးလာလို့ထင်တယ်။ ခါးက အရမ်းကိုက်တယ်။",
        translated: "Yes doctor. I think it's because of the pregnancy. My lower back hurts a lot.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Back pain is common during pregnancy. How many weeks are you now?",
        translated: "ကိုယ်ဝန်ဆောင်စဉ် ကျောနာတာ ဖြစ်တတ်ပါတယ်။ အခု ဘယ်နှစ်ပတ် ရှိပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "၂၈ ပတ် ရှိပါပြီ။",
        translated: "I'm 28 weeks now.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I'll show you some safe stretching exercises. Also, try to sleep on your side with a pillow between your knees.",
        translated: "ဘေးကင်းတဲ့ ဆန့်ကျင်လေ့ကျင့်ခန်းတွေ ပြပေးပါမယ်။ ဒူးကြားမှာ ခေါင်းအုံး ညှပ်ပြီး ဘေးလှဲအိပ်ကြည့်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျေးဇူးပါ ဆရာဝန်။ ဆေးသောက်လို့ ရလား?",
        translated: "Thank you doctor. Can I take any medicine?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "It's best to avoid medicine during pregnancy. But if the pain is severe, paracetamol is safe in small doses.",
        translated: "ကိုယ်ဝန်ဆောင်စဉ် ဆေးရှောင်တာ အကောင်းဆုံးပါ။ ဒါပေမယ့် အရမ်းနာရင် ပါရာစီတမောကို နည်းနည်း သောက်လို့ ရပါတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 9: Kyaw Soe Lin - Knee Injury (with Dr. Tanaka) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "500001",
    doctorUsername: "dr_tanaka",
    patientUsername: "patient_kyaw",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "What happened to your knee?",
        translated: "ဒူးက ဘာဖြစ်သွားတာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ မနေ့က ဘောလုံးကန်ရင်း ပြုတ်ကျသွားတယ်။ ဒူးက ရောင်နေပြီး အရမ်းနာတယ်။",
        translated: "Doctor, I fell while playing football yesterday. My knee is swollen and very painful.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Can you bend your knee? Let me take a look.",
        translated: "ဒူးကို ကွေးလို့ ရလား? ကြည့်လိုက်ပါရစေ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကွေးလို့ မရဘူး ဆရာဝန်။ နာလွန်းလို့။",
        translated: "I can't bend it, doctor. It's too painful.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "The swelling is significant. We need to do an X-ray to check if there's a fracture.",
        translated: "ရောင်တာ တော်တော်များတယ်။ အရိုးကျိုးမကျိုး စစ်ဖို့ X-ray ရိုက်ရပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အရိုးကျိုးနေမှာလား ဆရာဝန်?",
        translated: "Is it broken, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I'm not sure yet. Let's do the X-ray first. In the meantime, keep your leg elevated and apply ice.",
        translated: "မသေချာသေးဘူး။ X-ray အရင် ရိုက်ကြည့်ရအောင်။ ဒီအတောအတွင်း ခြေထောက်ကို မြှင့်ထားပြီး ရေခဲ ကပ်ထားပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။",
        translated: "Okay doctor.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Good news - the X-ray shows no fracture. It's a ligament sprain. You'll need to rest and use crutches for two weeks.",
        translated: "သတင်းကောင်းပါ - X-ray မှာ အရိုးကျိုးတာ မတွေ့ရဘူး။ အရွတ်ဆွဲချင်တာပါ။ နှစ်ပတ်လောက် အနားယူပြီး တုတ်ထောက် သုံးရပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဘောလုံး ဘယ်တော့ ပြန်ကန်လို့ ရမလဲ ဆရာဝန်?",
        translated: "When can I play football again, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "After 6 weeks minimum. Start with light exercises first. I'll refer you to a physiotherapist.",
        translated: "အနည်းဆုံး ၆ ပတ်ကြာမှ။ ပေါ့ပေါ့ပါးပါး လေ့ကျင့်ခန်းတွေနဲ့ စပါ။ ကာယကုဆရာဆီ လွှဲပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 10: Kyaw Soe Lin - Skin Rash (with Dr. Wong) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "500002",
    doctorUsername: "dr_wong",
    patientUsername: "patient_kyaw",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "I see you have a rash on your arms. When did it start?",
        translated: "လက်မောင်းပေါ်မှာ အဖုအပိန့်တွေ ပေါက်နေတာ မြင်ရတယ်။ ဘယ်တုန်းက စဖြစ်တာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "သုံးရက်လောက် ရှိပြီ ဆရာဝန်။ အရမ်းယားတယ်။",
        translated: "About three days ago, doctor. It's very itchy.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Did you eat anything new or use any new products?",
        translated: "အသစ် တစ်ခုခု စားခဲ့လား ဒါမှမဟုတ် ပစ္စည်းအသစ် တစ်ခုခု သုံးခဲ့လား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆပ်ပြာအသစ် သုံးခဲ့တယ်။ အဲဒါကြောင့် ဖြစ်တာလား?",
        translated: "I used a new soap. Is that why?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Most likely, yes. This looks like contact dermatitis. Stop using that soap and I'll prescribe a cream for the itch.",
        translated: "ဖြစ်နိုင်ခြေ များပါတယ်။ ဒါက ထိတွေ့မှုကြောင့် အရေပြားရောင်ရမ်းတာ ပုံပါပဲ။ အဲဒီဆပ်ပြာ မသုံးတော့ပါနဲ့။ ယားယံမှုအတွက် ခရင်မ် ပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဘယ်လောက်ကြာ လိမ်းရမလဲ?",
        translated: "How long should I apply it?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Apply it twice a day for one week. The rash should clear up in about 5-7 days.",
        translated: "တစ်နေ့ နှစ်ကြိမ် တစ်ပတ်လောက် လိမ်းပါ။ အဖုအပိန့်တွေ ၅-၇ ရက်လောက်မှာ ပျောက်သွားပါလိမ့်မယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 11: Aung Kyaw Moe - Chest Pain Emergency (with Dr. Wong) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "100003",
    doctorUsername: "dr_wong",
    patientUsername: "patient_aung",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "You mentioned chest pain. Can you describe it? Is it sharp or dull?",
        translated: "ရင်ဘတ်နာတယ်လို့ ပြောခဲ့တယ်။ ဘယ်လိုနာတာလဲ ပြောပြနိုင်မလား? ချွန်ချွန်နာတာလား ဒါမှမဟုတ် တုံးတုံးနာတာလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ချွန်ချွန်နာတယ် ဆရာဝန်။ အသက်ရှူရင် ပိုနာတယ်။",
        translated: "It's a sharp pain, doctor. It hurts more when I breathe.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Does the pain spread to your arm or jaw?",
        translated: "နာကျင်မှုက လက်မောင်း ဒါမှမဟုတ် မေးရိုးဆီ ပျံ့သွားလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မပျံ့ဘူး ဆရာဝန်။ ဒီနေရာမှာပဲ နာတာ။",
        translated: "No, doctor. It only hurts here.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Let me do an ECG to check your heart. Have you had any heart problems before?",
        translated: "နှလုံးစစ်ဖို့ ECG လုပ်ကြည့်ပါရစေ။ အရင်က နှလုံးပြဿနာ ရှိဖူးလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မရှိဖူးပါဘူး ဆရာဝန်။ ဒါက ပထမဆုံးအကြိမ်ပါ။",
        translated: "No, doctor. This is the first time.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Your ECG looks normal. This might be muscular pain. Have you lifted anything heavy recently?",
        translated: "ECG က ပုံမှန်ပါပဲ။ ဒါက ကြွက်သားနာတာ ဖြစ်နိုင်တယ်။ မကြာသေးခင်က လေးတဲ့ဟာ မြှင့်ခဲ့လား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့၊ မနေ့က ပရိဘောဂ ရွှေ့တယ်။",
        translated: "Yes, I moved furniture yesterday.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "That explains it. This is muscle strain, not a heart problem. Take ibuprofen for the pain and rest for a few days.",
        translated: "အဲဒါကြောင့်ပါ။ ဒါက ကြွက်သား ဆွဲချင်တာပါ၊ နှလုံးပြဿနာ မဟုတ်ဘူး။ နာကျင်မှုအတွက် အိုင်ဗူပရိုဖင် သောက်ပြီး ရက်အနည်းငယ် အနားယူပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "စိတ်သက်သာသွားပါပြီ ဆရာဝန်။ ကျေးဇူးတင်ပါတယ်။",
        translated: "I'm relieved, doctor. Thank you.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "You're welcome. But if the pain gets worse or spreads to your arm, come back immediately.",
        translated: "ရပါတယ်။ ဒါပေမယ့် နာကျင်မှု ပိုဆိုးလာရင် ဒါမှမဟုတ် လက်မောင်းဆီ ပျံ့သွားရင် ချက်ချင်း ပြန်လာပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 12: Thida Win - Eye Problem (with Dr. Tanaka) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "200003",
    doctorUsername: "dr_tanaka",
    patientUsername: "patient_thida",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "What's the problem with your eyes?",
        translated: "မျက်စိက ဘာဖြစ်နေတာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ မျက်စိ ဝါးလာတယ်။ အဝေးက စာတွေ ဖတ်လို့ မရတော့ဘူး။",
        translated: "Doctor, my vision is getting blurry. I can't read text from far away anymore.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "How long has this been happening?",
        translated: "ဒါ ဘယ်လောက်ကြာ ဖြစ်နေပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "တစ်လလောက် ရှိပြီ။ အရင်ကတော့ ကောင်းကောင်း မြင်ရတယ်။",
        translated: "About a month now. I used to see clearly before.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Let me check your eyes. Please look straight ahead... Your vision has changed. You may need glasses.",
        translated: "မျက်စိ စစ်ကြည့်ပါရစေ။ ရှေ့ကို ကြည့်ပါ... မျက်စိ ပြောင်းလဲသွားပြီ။ မျက်မှန် တပ်ရလိမ့်မယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မျက်မှန်လိုအပ်တာလား ဆရာဝန်?",
        translated: "Do I need glasses, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Yes, for distance. I'll write a prescription for glasses. You can get them at any optical shop.",
        translated: "ဟုတ်တယ်၊ အဝေးကြည့်ဖို့။ မျက်မှန်အတွက် ဆေးစာ ရေးပေးပါမယ်။ မျက်မှန်ဆိုင် ဘယ်ဆိုင်မှာမဆို ဝယ်လို့ ရပါတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 13: Zaw Min Oo - High Blood Pressure (with Dr. Smith) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "300003",
    doctorUsername: "dr_smith",
    patientUsername: "patient_zaw",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Your blood pressure is quite high today - 160 over 100.",
        translated: "ဒီနေ့ သွေးပေါင်ချိန် တော်တော် မြင့်နေတယ် - ၁၆၀/၁၀၀။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆိုးရွားပါသလား ဆရာဝန်? အရင်က ပုံမှန်ပါ။",
        translated: "Is that bad, doctor? It was normal before.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "It's concerning. High blood pressure can lead to heart disease and stroke if not controlled.",
        translated: "စိုးရိမ်စရာပါ။ သွေးတိုးရင် ထိန်းမထားရင် နှလုံးရောဂါနဲ့ လေဖြတ်တာ ဖြစ်နိုင်တယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဘာလို့ ရုတ်တရက် တက်သွားတာလဲ ဆရာဝန်?",
        translated: "Why did it suddenly go up, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Have you been eating salty food? Or are you under stress?",
        translated: "ငန်တဲ့အစားအစာ များများ စားနေလား? ဒါမှမဟုတ် စိတ်ဖိစီးနေလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အလုပ်မှာ စိတ်ဖိစီးမှု တော်တော် ရှိတယ် အခုလပိုင်း။ အိပ်ရေးလည်း မဝဘူး။",
        translated: "I've been very stressed at work this month. I haven't been sleeping well either.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Stress and lack of sleep can raise blood pressure. I'll prescribe medication, but you also need to reduce stress and sleep more.",
        translated: "စိတ်ဖိစီးမှုနဲ့ အိပ်ရေးမဝတာက သွေးတိုးစေနိုင်တယ်။ ဆေးပေးပါမယ်၊ ဒါပေမယ့် စိတ်ဖိစီးမှု လျှော့ပြီး ပိုအိပ်ဖို့ လိုတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 14: Hla Hla Myint - Allergy Reaction (with Dr. Wong) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "400003",
    doctorUsername: "dr_wong",
    patientUsername: "patient_hla",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "What brings you in today? You look uncomfortable.",
        translated: "ဒီနေ့ ဘာကြောင့် လာတာလဲ? မသက်မသာ ဖြစ်နေပုံပဲ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ ပုစွန်စားပြီးတာနဲ့ နှုတ်ခမ်းရောင်လာတယ်၊ ခန္ဓာကိုယ် ယားလာတယ်။",
        translated: "Doctor, after eating shrimp my lips swelled up and my body became itchy.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "This is an allergic reaction. Have you had this before with seafood?",
        translated: "ဒါက ဓာတ်မတည့်တာ။ အရင်က ပင်လယ်စာ စားလို့ ဒီလိုဖြစ်ဖူးလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "မဖြစ်ဖူးဘူး။ ပထမဆုံးအကြိမ်ပါ။",
        translated: "Never. This is the first time.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I'll give you an antihistamine injection now. It will help reduce the swelling quickly.",
        translated: "အခု ဓာတ်မတည့်တာ သက်သာဆေး ထိုးပေးပါမယ်။ ရောင်တာ မြန်မြန်ကျသွားပါလိမ့်မယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျေးဇူးပါ ဆရာဝန်။ နောက်ကနေ ပုစွန် မစားတော့ဘူး။",
        translated: "Thank you doctor. I won't eat shrimp anymore.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Yes, you should avoid all shellfish from now on. I'll also give you antihistamine pills to carry with you in case of emergency.",
        translated: "ဟုတ်တယ်၊ အခွံပါ ပင်လယ်စာ အကုန်လုံး ရှောင်သင့်တယ်။ အရေးပေါ်အတွက် ဆောင်ထားဖို့ ဓာတ်မတည့်ဆေး အလုံးလည်း ပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 15: Kyaw Soe Lin - Insomnia (with Dr. Chen) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "500003",
    doctorUsername: "dr_chen",
    patientUsername: "patient_kyaw",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "You mentioned you've been having trouble sleeping. Tell me more about it.",
        translated: "အိပ်ရေးမဝဘူးလို့ ပြောခဲ့တယ်။ အသေးစိတ် ပြောပြပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ ညဘက် အိပ်ပျော်ဖို့ အရမ်းခက်တယ်။ နှစ်နာရီ သုံးနာရီလောက်ပဲ အိပ်ရတယ်။",
        translated: "Doctor, it's very hard to fall asleep at night. I only sleep for two or three hours.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "How long has this been going on?",
        translated: "ဒါ ဘယ်လောက်ကြာ ဖြစ်နေပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "နှစ်လလောက် ရှိပြီ။ စိတ်ဖိစီးမှုကြောင့် ထင်တယ်။",
        translated: "About two months. I think it's because of stress.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Do you use your phone in bed? Or drink coffee in the evening?",
        translated: "အိပ်ရာပေါ်မှာ ဖုန်းသုံးလား? ညနေပိုင်း ကော်ဖီ သောက်လား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဖုန်းတော့ သုံးတယ်၊ အိပ်ပျော်သွားတဲ့အထိ။ ကော်ဖီလည်း ညနေပိုင်း တစ်ခွက် သောက်တယ်။",
        translated: "I do use my phone until I fall asleep. I also have one coffee in the evening.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Both can affect your sleep. Try to stop using your phone one hour before bed, and avoid coffee after 3 PM.",
        translated: "နှစ်ခုလုံးက အိပ်ရေးကို သက်ရောက်နိုင်တယ်။ အိပ်ယာဝင်ခါနီး တစ်နာရီအလို ဖုန်းမသုံးပါနဲ့၊ ညနေ ၃ နာရီနောက်ပိုင်း ကော်ဖီ မသောက်ပါနဲ့။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 16: Aung Kyaw Moe - Toothache (with Dr. Tanaka) - WAITING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "100004",
    doctorUsername: "dr_tanaka",
    patientUsername: null,
    doctorLang: "en",
    patientLang: "my",
    status: "waiting",
    transcripts: [],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 17: Thida Win - Anxiety (with Dr. Smith) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "200004",
    doctorUsername: "dr_smith",
    patientUsername: "patient_thida",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "I understand you've been feeling anxious lately. Can you describe how you feel?",
        translated: "မကြာသေးခင်က စိတ်ပူပန်နေတယ်လို့ သိရပါတယ်။ ဘယ်လိုခံစားရတယ်ဆိုတာ ပြောပြနိုင်မလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆရာဝန်၊ နှလုံးခုန်မြန်တယ်၊ အသက်ရှူရ ခက်တယ်။ ရုတ်တရက် ကြောက်လန့်သွားတယ်။",
        translated: "Doctor, my heart beats fast and I have trouble breathing. I suddenly feel scared.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Does this happen often? When did it start?",
        translated: "ဒါ မကြာခဏ ဖြစ်လား? ဘယ်တုန်းက စဖြစ်တာလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "တစ်ပတ်ကို နှစ်ကြိမ် သုံးကြိမ်လောက် ဖြစ်တယ်။ လွန်ခဲ့တဲ့ လကနေ စဖြစ်တာ။",
        translated: "It happens two or three times a week. It started last month.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "These sound like panic attacks. Is there anything stressful happening in your life right now?",
        translated: "ဒါတွေက ထိတ်လန့်မှု ဖြစ်ပုံရတယ်။ ဘဝမှာ စိတ်ဖိစီးစေတဲ့အရာ တစ်ခုခု ရှိနေလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "အလုပ်မှာ ပြဿနာတွေ ရှိတယ်။ အိမ်မှာလည်း မကောင်းဘူး။",
        translated: "I have problems at work. Things aren't good at home either.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "I understand. I'll refer you to a counselor. In the meantime, try deep breathing exercises when you feel anxious.",
        translated: "နားလည်ပါတယ်။ အကြံပေးပညာရှင် ဆီ လွှဲပေးပါမယ်။ ဒီအတောအတွင်း စိတ်ပူပန်ရင် အသက်ရှိုက် လေ့ကျင့်ခန်းတွေ လုပ်ကြည့်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 18: Zaw Min Oo - Joint Pain (with Dr. Wong) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "300004",
    doctorUsername: "dr_wong",
    patientUsername: "patient_zaw",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "Where exactly is the joint pain?",
        translated: "အဆစ်နာတာ ဘယ်နေရာမှာ အတိအကျလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဒူးတွေနဲ့ လက်ချောင်းတွေမှာ ဆရာဝန်။ မနက်ပိုင်း ပိုနာတယ်။",
        translated: "In my knees and fingers, doctor. It's worse in the morning.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "How old are you?",
        translated: "အသက် ဘယ်လောက်ရှိပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "၅၅ နှစ် ရှိပါပြီ ဆရာဝန်။",
        translated: "I'm 55 years old, doctor.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "This could be arthritis. It's common at your age. Let me do a blood test to confirm.",
        translated: "ဒါက အဆစ်ရောင်ရမ်းရောဂါ ဖြစ်နိုင်တယ်။ သင့်အသက်အရွယ်မှာ ဖြစ်တတ်ပါတယ်။ အတည်ပြုဖို့ သွေးစစ်ကြည့်ပါရစေ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကုသလို့ ရပါသလား ဆရာဝန်?",
        translated: "Can it be treated, doctor?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Yes, with medication and physical therapy. Regular exercise also helps reduce the pain.",
        translated: "ရပါတယ်၊ ဆေးနဲ့ ကာယကုထုံးနဲ့။ ပုံမှန် လေ့ကျင့်ခန်း လုပ်တာကလည်း နာကျင်မှု သက်သာစေတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 19: Hla Hla Myint - Child's Vaccination (with Dr. Tanaka) - ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "400004",
    doctorUsername: "dr_tanaka",
    patientUsername: "patient_hla",
    doctorLang: "en",
    patientLang: "my",
    status: "active",
    transcripts: [
      {
        role: "doctor",
        original: "Hello! I see you've brought your baby for vaccination. How old is the baby?",
        translated: "မင်္ဂလာပါ! ကလေးကို ကာကွယ်ဆေးထိုးဖို့ ခေါ်လာတာ မြင်ရတယ်။ ကလေးက အသက် ဘယ်လောက်ရှိပြီလဲ?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ခြောက်လ ရှိပါပြီ ဆရာဝန်။ အစာစမ်းလည်း စကျွေးပြီ။",
        translated: "Six months old, doctor. We've also started giving solid food.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Good. Today we'll give the DPT vaccine. Is the baby healthy? No fever or cold?",
        translated: "ကောင်းပါပြီ။ ဒီနေ့ DPT ကာကွယ်ဆေး ထိုးပေးပါမယ်။ ကလေးက ကျန်းမာရဲ့လား? ဖျားတာ ဒါမှမဟုတ် အအေးမိတာ မရှိဘူးလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ကျန်းမာပါတယ် ဆရာဝန်။ ဖျားတာ မရှိဘူး။",
        translated: "The baby is healthy, doctor. No fever.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "After the injection, the baby might have a mild fever. That's normal. Give paracetamol if needed.",
        translated: "ဆေးထိုးပြီးရင် ကလေးက အဖျားနည်းနည်း ရှိနိုင်တယ်။ အဲဒါ ပုံမှန်ပါ။ လိုအပ်ရင် ပါရာစီတမော တိုက်ပါ။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ နောက်တစ်ကြိမ် ဘယ်တုန်းက လာရမလဲ?",
        translated: "Okay doctor. When should we come for the next one?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "In two months, when the baby is eight months old. I'll write it in the vaccination card.",
        translated: "နှစ်လကြာရင်၊ ကလေးက ရှစ်လ ရှိတဲ့အခါ။ ကာကွယ်ဆေး ကတ်ထဲမှာ ရေးပေးပါမယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASE 20: Kyaw Soe Lin - Dental Checkup (with Dr. Smith) - CLOSED
  // ═══════════════════════════════════════════════════════════════════════════
  {
    code: "500004",
    doctorUsername: "dr_smith",
    patientUsername: "patient_kyaw",
    doctorLang: "en",
    patientLang: "my",
    status: "closed",
    transcripts: [
      {
        role: "doctor",
        original: "I see you're here for a dental checkup. Any problems with your teeth?",
        translated: "သွားစစ်ဖို့ လာတယ်လို့ တွေ့ရတယ်။ သွားမှာ ပြဿနာ တစ်ခုခု ရှိလား?",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဟုတ်ကဲ့ ဆရာဝန်။ နောက်သွားတစ်ချောင်း နာတယ်။ အအေးစားရင် ပိုနာတယ်။",
        translated: "Yes doctor. One of my back teeth hurts. It's worse when I eat cold food.",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Let me take a look. Please open your mouth wide... I see a cavity on your lower right molar.",
        translated: "ကြည့်လိုက်ပါရစေ။ ပါးစပ် အကျယ် ဟပါ... အောက်ညာဘက် အံသွားမှာ အပေါက် တွေ့ရတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဆိုးရွားလား ဆရာဝန်? သွားဖြည်ဖို့ လိုမလား?",
        translated: "Is it bad, doctor? Does it need to be filled?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Yes, we need to fill it before it gets worse. We can do it today if you have time.",
        translated: "ဟုတ်ကဲ့၊ မဆိုးသွားခင် ဖြည့်ဖို့ လိုတယ်။ အချိန်ရရင် ဒီနေ့ပဲ လုပ်လို့ ရတယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
      {
        role: "patient",
        original: "ဒီနေ့ပဲ လုပ်လိုက်ပါ ဆရာဝန်။ ထိုင်းဆေး ထိုးပေးမှာလား?",
        translated: "Let's do it today, doctor. Will you give me anesthesia?",
        originalLang: "my",
        translatedLang: "en",
      },
      {
        role: "doctor",
        original: "Yes, I'll numb the area first so you won't feel any pain. The procedure will take about 30 minutes.",
        translated: "ဟုတ်တယ်၊ နာမခံစားရအောင် အဲဒီနေရာကို အရင် ထိုင်းသွားစေပါမယ်။ လုပ်ငန်းစဉ်က မိနစ် ၃၀ လောက် ကြာပါလိမ့်မယ်။",
        originalLang: "en",
        translatedLang: "my",
      },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`);
}

async function deleteCollection(collectionPath: string) {
  const col = db.collection(collectionPath);
  const batch = db.batch();
  const snapshot = await col.limit(500).get();

  if (snapshot.empty) return 0;

  // Delete subcollections first for rooms
  if (collectionPath === "rooms") {
    for (const doc of snapshot.docs) {
      const transcripts = await doc.ref.collection("transcripts").limit(500).get();
      transcripts.docs.forEach((t) => batch.delete(t.ref));
    }
  }

  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("\n========================================");
  console.log("  MedInterpreter — Firestore Seed");
  console.log("========================================\n");

  log("🔧", `Project: ${PROJECT_ID}`);
  log("🔧", `Emulator: ${process.env.FIRESTORE_EMULATOR_HOST || "(not set — writing to REAL Firestore!)"}`);
  log("🔧", `Clean: ${CLEAN}`);
  log("🔧", `Dry run: ${DRY_RUN}\n`);

  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.argv.includes("--force")) {
    console.log("WARNING: No FIRESTORE_EMULATOR_HOST set. This will write to REAL Firestore.");
    console.log("         Add --force flag to proceed, or set FIRESTORE_EMULATOR_HOST.\n");
    process.exit(1);
  }

  if (DRY_RUN) {
    log("📋", `Would create ${USERS.length} users`);
    log("📋", `Would create ${ROOMS.length} rooms`);
    const totalTranscripts = ROOMS.reduce((n, r) => n + r.transcripts.length, 0);
    log("📋", `Would create ${totalTranscripts} transcript entries`);
    console.log("\nDry run complete. No data written.\n");
    return;
  }

  // ── Clean ──
  if (CLEAN) {
    log("🗑️ ", "Cleaning existing data...");
    const usersDeleted = await deleteCollection("users");
    const roomsDeleted = await deleteCollection("rooms");
    log("🗑️ ", `Deleted ${usersDeleted} users, ${roomsDeleted} rooms`);
  }

  // ── Users ──
  log("👤", "Creating users...");
  const usersCol = db.collection("users");

  for (const u of USERS) {
    // Skip if user already exists
    const existing = await usersCol.where("username", "==", u.username).limit(1).get();
    if (!existing.empty) {
      log("⏭️ ", `  ${u.username} (${u.role}) — already exists, skipping`);
      continue;
    }

    const passwordHash = await bcrypt.hash(u.password, 12);
    const userData: Record<string, unknown> = {
      username: u.username,
      passwordHash,
      role: u.role,
      displayName: u.displayName,
      gender: u.gender,
      createdAt: Timestamp.now(),
    };
    // Add doctor-specific fields
    if ("specialty" in u) userData.specialty = u.specialty;
    if ("hospital" in u) userData.hospital = u.hospital;
    if ("department" in u) userData.department = u.department;
    if ("licenseNumber" in u) userData.licenseNumber = u.licenseNumber;
    // Add patient-specific fields
    if ("dateOfBirth" in u) userData.dateOfBirth = u.dateOfBirth;
    if ("nationality" in u) userData.nationality = u.nationality;
    if ("idNumber" in u) userData.idNumber = u.idNumber;
    if ("bloodType" in u) userData.bloodType = u.bloodType;
    if ("height" in u) userData.height = u.height;
    if ("weight" in u) userData.weight = u.weight;
    if ("bloodPressure" in u) userData.bloodPressure = u.bloodPressure;
    if ("allergies" in u) userData.allergies = u.allergies;
    if ("currentMedications" in u) userData.currentMedications = u.currentMedications;
    if ("medicalConditions" in u) userData.medicalConditions = u.medicalConditions;

    await usersCol.add(userData);
    log("✅", `  ${u.username} (${u.role}, ${u.gender}) — password: ${u.password}`);
  }

  // ── Rooms + Transcripts ──
  log("🏥", "Creating rooms...");
  const roomsCol = db.collection("rooms");

  for (const r of ROOMS) {
    // Skip if room code already exists
    const existing = await roomsCol.where("code", "==", r.code).limit(1).get();
    if (!existing.empty) {
      log("⏭️ ", `  Room ${r.code} — already exists, skipping`);
      continue;
    }

    const roomRef = await roomsCol.add({
      code: r.code,
      doctorUsername: r.doctorUsername,
      patientUsername: r.patientUsername,
      doctorLang: r.doctorLang,
      patientLang: r.patientLang,
      status: r.status,
      createdAt: Timestamp.now(),
    });

    const statusLabel =
      r.status === "waiting" ? "waiting" :
      r.status === "active" ? "active" :
      "closed";

    log("✅", `  Room ${r.code} [${statusLabel}] ${r.doctorLang}<>${r.patientLang} — ${r.doctorUsername} + ${r.patientUsername || "(empty)"}`);

    // Add transcripts
    if (r.transcripts.length > 0) {
      const transcriptsCol = roomRef.collection("transcripts");
      const baseTime = Date.now() - r.transcripts.length * 15_000; // 15s apart

      for (let i = 0; i < r.transcripts.length; i++) {
        const t = r.transcripts[i];
        await transcriptsCol.add({
          id: `seed-${r.code}-${i}`,
          role: t.role,
          original: t.original,
          translated: t.translated,
          originalLang: t.originalLang,
          translatedLang: t.translatedLang,
          timestamp: baseTime + i * 15_000,
          savedAt: Timestamp.now(),
        });
      }
      log("💬", `     + ${r.transcripts.length} transcript entries`);
    }
  }

  // ── Summary ──
  console.log("\n========================================");
  console.log("  Seed complete!");
  console.log("========================================");

  const doctors = USERS.filter((u) => u.role === "doctor");
  const patients = USERS.filter((u) => u.role === "patient");
  const activeRooms = ROOMS.filter((r) => r.status === "active");
  const closedRooms = ROOMS.filter((r) => r.status === "closed");
  const waitingRooms = ROOMS.filter((r) => r.status === "waiting");

  console.log(`
  ┌─────────────────────────────────────────────────────────────┐
  │  USERS (${USERS.length} total)                                           │
  ├─────────────────────────────────────────────────────────────┤
  │  DOCTORS (password: doctor123)                              │
  │    • dr_smith    - Dr. James Smith                          │
  │    • dr_chen     - Dr. Emily Chen                           │
  │    • dr_tanaka   - Dr. Yuki Tanaka                          │
  │    • dr_wong     - Dr. Michael Wong                         │
  ├─────────────────────────────────────────────────────────────┤
  │  PATIENTS (password: patient123)                            │
  │    • patient_aung  - Aung Kyaw Moe   (3 cases)              │
  │    • patient_thida - Thida Win       (4 cases)              │
  │    • patient_zaw   - Zaw Min Oo      (4 cases)              │
  │    • patient_hla   - Hla Hla Myint   (4 cases)              │
  │    • patient_kyaw  - Kyaw Soe Lin    (4 cases)              │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  ROOMS (${ROOMS.length} total)                                            │
  ├─────────────────────────────────────────────────────────────┤
  │  ${activeRooms.length} Active | ${closedRooms.length} Closed | ${waitingRooms.length} Waiting                              │
  │  ${ROOMS.reduce((n, r) => n + r.transcripts.length, 0)} transcript entries                                   │
  └─────────────────────────────────────────────────────────────┘

  QUICK TEST ROOMS:
  ─────────────────
  • 100001 - dr_smith + patient_aung (Fever & Cold) - ACTIVE
  • 200001 - dr_chen + patient_thida (Stomach Pain) - ACTIVE
  • 300001 - dr_chen + patient_zaw (Diabetes Check) - ACTIVE
  • 400001 - dr_chen + patient_hla (Pregnancy) - ACTIVE
  • 500001 - dr_tanaka + patient_kyaw (Knee Injury) - ACTIVE
  `);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
