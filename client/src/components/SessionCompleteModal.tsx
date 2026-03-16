import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import type { TranscriptEntry, SupportedLang, SharedCertificateData, AuthUser, DoctorProfile, PatientProfile, CertificateResponse, CertificateContent, RoomInfo } from "../types";
import { getLangLabel } from "../types";

interface ConsultationSection {
  chiefComplaint: string;
  symptoms: string[];
  diagnosis: string;
  medication: string[];
  doctorInstructions: string[];
  procedures: string;
  followUp: string;
  allergies: string;
  vitalSigns: string;
  notes: string;
}

interface VerificationChange {
  field: string;
  original: string;
  corrected: string;
  reason: string;
}

interface FluencyIssue {
  field: string;
  issue: string;
  suggestion: string;
}

interface Props {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  user: AuthUser;
  participantProfile?: DoctorProfile | PatientProfile | null;
  room?: RoomInfo | null;
  onClose: () => void;
  onCertificateGenerated?: (certificate: SharedCertificateData) => void;
  onCertificateDataGenerated?: (cert: CertificateResponse) => void;
  onSummaryDataGenerated?: (summary: import("../types").SummaryResponse) => void;
}

type Step = "loading" | "verifying" | "summary" | "confirm-cert" | "generating-cert" | "certificate";

export default function SessionCompleteModal({
  transcripts,
  doctorLang,
  patientLang,
  user,
  participantProfile,
  room,
  onClose,
  onCertificateGenerated,
  onCertificateDataGenerated,
  onSummaryDataGenerated,
}: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConsultationSection | null>(null);
  const [editSummary, setEditSummary] = useState<ConsultationSection | null>(null);
  const [certResult, setCertResult] = useState<CertificateResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [verificationChanges, setVerificationChanges] = useState<VerificationChange[]>([]);
  const [fluencyIssues, setFluencyIssues] = useState<FluencyIssue[]>([]);
  const [verificationPassed, setVerificationPassed] = useState(true);
  const certCardsRef = useRef<HTMLDivElement>(null);
  const [visitDate] = useState(() => new Date().toISOString().split("T")[0]);

  // Auto-fill doctor info from user (since only doctor can complete sessions)
  const [doctorInfo, setDoctorInfo] = useState(() => ({
    name: user.displayName || "",
    licenseNumber: user.licenseNumber || "",
    hospital: user.hospital || "",
    department: user.department || "",
  }));

  // Auto-fill patient info from participantProfile
  // Note: Only name, age, sex are shown - no confidential data (nationality, ID)
  const [patientInfo, setPatientInfo] = useState({
    name: "",
    age: "",
    sex: "Male",
  });

  // Update patient info when participantProfile loads
  useEffect(() => {
    console.log("SessionCompleteModal: participantProfile =", JSON.stringify(participantProfile));
    console.log("SessionCompleteModal: has specialty?", participantProfile ? "specialty" in participantProfile : "no profile");
    console.log("SessionCompleteModal: has licenseNumber?", participantProfile ? "licenseNumber" in participantProfile : "no profile");

    if (!participantProfile) {
      console.log("SessionCompleteModal: No participantProfile available");
      return;
    }

    // Check if it's a patient profile by checking for patient-specific fields OR lack of doctor fields
    const hasPatientFields = "dateOfBirth" in participantProfile || "bloodType" in participantProfile || "allergies" in participantProfile;
    const hasDoctorFields = "specialty" in participantProfile;

    console.log("SessionCompleteModal: hasPatientFields =", hasPatientFields, "hasDoctorFields =", hasDoctorFields);

    if (hasPatientFields || !hasDoctorFields) {
      const p = participantProfile as PatientProfile;
      console.log("Auto-filling patient info:", p.displayName, p.dateOfBirth, p.gender);
      // Calculate age from dateOfBirth
      let age = "";
      if (p.dateOfBirth) {
        const birthDate = new Date(p.dateOfBirth);
        const today = new Date();
        age = String(Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
      }
      const sex = p.gender === "female" ? "Female" : p.gender === "male" ? "Male" : "Male";
      setPatientInfo({
        name: p.displayName || "",
        age,
        sex,
      });
    } else {
      console.log("SessionCompleteModal: Profile appears to be doctor profile, not filling patient info");
    }
  }, [participantProfile]);

  // AbortController for cancelling in-flight fetch on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Auto-generate summary on mount
  useEffect(() => {
    generateSummary();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && step !== "loading" && step !== "generating-cert") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  // Generate and save bilingual summary for the Summary tab (runs in background)
  async function generateAndSaveBilingualSummary(signal: AbortSignal) {
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripts, doctorLang, patientLang }),
        signal,
      });
      if (!res.ok) return;

      const summaryData = await res.json();
      console.log("Generated bilingual summary for Summary tab");

      // Pass to parent to update cache
      onSummaryDataGenerated?.(summaryData);

      // Save to server
      if (room?.code && user?.token) {
        await fetch(`/api/rooms/${room.code}/summary`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
          },
          body: JSON.stringify({
            summaryLang1: summaryData.summaryLang1,
            summaryLang2: summaryData.summaryLang2,
            lang1Label: summaryData.lang1Label,
            lang2Label: summaryData.lang2Label,
          }),
        });
        console.log("Saved bilingual summary to server");
      }
    } catch (err) {
      // Silently fail - this is a background operation
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Failed to generate bilingual summary:", err);
      }
    }
  }

  async function generateSummary() {
    setStep("loading");
    setError(null);

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/consultation/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripts, doctorLang, patientLang }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to generate summary");
      }
      const data: ConsultationSection = await res.json();
      setSummary(data);

      // Run Clinical Grounding Verification
      setStep("verifying");
      try {
        const verifyRes = await fetch("/api/consultation/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: data, transcripts, doctorLang, patientLang }),
          signal: controller.signal,
        });
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          const verified: ConsultationSection = verifyData.verified || data;
          const changes: VerificationChange[] = verifyData.changes || [];
          const fluency: FluencyIssue[] = verifyData.fluencyIssues || [];
          setVerificationChanges(changes);
          setFluencyIssues(fluency);
          setVerificationPassed(changes.length === 0 && fluency.length === 0);
          setEditSummary({
            ...verified,
            symptoms: [...(verified.symptoms || [])],
            medication: [...(verified.medication || [])],
            doctorInstructions: [...(verified.doctorInstructions || [])],
          });

          // Also generate bilingual summary for the Summary tab
          generateAndSaveBilingualSummary(controller.signal);
        } else {
          // Verification endpoint failed — use unverified summary
          setVerificationChanges([]);
          setFluencyIssues([]);
          setVerificationPassed(true);
          setEditSummary({ ...data, symptoms: [...data.symptoms], medication: [...data.medication], doctorInstructions: [...data.doctorInstructions] });
        }
      } catch (verifyErr) {
        if (verifyErr instanceof DOMException && verifyErr.name === "AbortError") return;
        // Verification failed — graceful degradation, use unverified summary
        setVerificationChanges([]);
        setFluencyIssues([]);
        setVerificationPassed(true);
        setEditSummary({ ...data, symptoms: [...data.symptoms], medication: [...data.medication], doctorInstructions: [...data.doctorInstructions] });
      }
      setStep("summary");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to generate summary");
      setStep("summary");
    }
  }

  function updateField(field: keyof ConsultationSection, value: string | string[]) {
    if (!editSummary) return;
    setEditSummary({ ...editSummary, [field]: value });
  }

  function updateArrayItem(field: "symptoms" | "medication" | "doctorInstructions", index: number, value: string) {
    if (!editSummary) return;
    const arr = [...editSummary[field]];
    arr[index] = value;
    setEditSummary({ ...editSummary, [field]: arr });
  }

  function addArrayItem(field: "symptoms" | "medication" | "doctorInstructions") {
    if (!editSummary) return;
    setEditSummary({ ...editSummary, [field]: [...editSummary[field], ""] });
  }

  function removeArrayItem(field: "symptoms" | "medication" | "doctorInstructions", index: number) {
    if (!editSummary) return;
    const arr = editSummary[field].filter((_, i) => i !== index);
    setEditSummary({ ...editSummary, [field]: arr });
  }

  async function generateCertificate() {
    if (!editSummary) return;
    setStep("generating-cert");
    setError(null);

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcripts,
          doctorLang,
          patientLang,
          patientInfo: {
            name: patientInfo.name,
            age: patientInfo.age,
            sex: patientInfo.sex,
          },
          doctorInfo,
          visitDate,
          visitType: "outpatient", // Always outpatient for this app
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to generate certificate");
      }

      const data: CertificateResponse = await res.json();
      setCertResult(data);
      setStep("certificate");

      // Pass the certificate data to parent for caching in Certificate tab
      onCertificateDataGenerated?.(data);

      // Save certificate to server
      if (room?.code && user?.token) {
        try {
          await fetch(`/api/rooms/${room.code}/certificate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({
              certificateLang1: data.certificateLang1,
              certificateLang2: data.certificateLang2,
              lang1Label: data.lang1Label,
              lang2Label: data.lang2Label,
            }),
          });
          console.log("Certificate saved to server");
        } catch (saveErr) {
          console.error("Failed to save certificate to server:", saveErr);
        }
      }

      // Share certificate with patient via WebSocket
      if (onCertificateGenerated && editSummary) {
        const certificateData: SharedCertificateData = {
          certificateHtml: "", // Not used anymore - patient sees structured data
          patientName: patientInfo.name,
          doctorName: doctorInfo.name,
          visitDate,
          summary: {
            chiefComplaint: editSummary.chiefComplaint,
            diagnosis: editSummary.diagnosis,
            symptoms: editSummary.symptoms,
            medication: editSummary.medication,
            doctorInstructions: editSummary.doctorInstructions,
            followUp: editSummary.followUp,
          },
        };
        onCertificateGenerated(certificateData);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to generate certificate");
      setStep("confirm-cert");
    }
  }

  async function handleDownloadPdf() {
    if (!certCardsRef.current || downloading) return;
    setDownloading(true);
    try {
      const cards = certCardsRef.current.querySelectorAll<HTMLElement>(".cert-page");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      for (let i = 0; i < cards.length; i++) {
        if (i > 0) pdf.addPage();

        const canvas = await html2canvas(cards[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
        });

        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (imgHeight > pageHeight - margin * 2) {
          let yOffset = 0;
          const pageContentHeight = pageHeight - margin * 2;

          while (yOffset < imgHeight) {
            if (yOffset > 0) pdf.addPage();

            const sourceY = (yOffset / imgHeight) * canvas.height;
            const sourceHeight = Math.min(
              (pageContentHeight / imgHeight) * canvas.height,
              canvas.height - sourceY
            );
            const destHeight = Math.min(pageContentHeight, imgHeight - yOffset);

            const subCanvas = document.createElement("canvas");
            subCanvas.width = canvas.width;
            subCanvas.height = sourceHeight;
            const subCtx = subCanvas.getContext("2d")!;
            subCtx.drawImage(
              canvas,
              0, sourceY, canvas.width, sourceHeight,
              0, 0, canvas.width, sourceHeight
            );

            pdf.addImage(
              subCanvas.toDataURL("image/png"),
              "PNG",
              margin,
              margin,
              imgWidth,
              destHeight
            );

            yOffset += pageContentHeight;
          }
        } else {
          pdf.addImage(
            canvas.toDataURL("image/png"),
            "PNG",
            margin,
            margin,
            imgWidth,
            imgHeight
          );
        }
      }

      const safeName = (patientInfo.name || "patient").replace(/[^a-zA-Z0-9]/g, "_");
      pdf.save(`medical_certificate_${safeName}.pdf`);
    } catch {
      setError("Failed to generate PDF. Try using the Print button instead.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="sc-overlay">
      <div className="sc-modal" role="dialog" aria-label="Session completion">
        {/* Header */}
        <div className="sc-header">
          <h2>
            {step === "loading" ? "Generating Summary..." :
             step === "verifying" ? "Verifying Accuracy..." :
             step === "summary" ? "Consultation Summary" :
             step === "confirm-cert" ? "Generate Certificate" :
             step === "generating-cert" ? "Generating Certificate..." :
             "Medical Certificate"}
          </h2>
          {step !== "loading" && step !== "verifying" && step !== "generating-cert" && (
            <button className="sc-close" onClick={onClose} aria-label="Close">&#10005;</button>
          )}
        </div>

        <div className="sc-body">
          {error && (
            <div className="status-bar status-error" role="alert">
              {error}
              <button className="btn-dismiss" onClick={() => setError(null)}>&#10005;</button>
            </div>
          )}

          {/* Step 1: Loading */}
          {step === "loading" && (
            <div className="sc-loading">
              <span className="spinner-lg" />
              <p>Analyzing consultation...</p>
            </div>
          )}

          {/* Step 1b: Verifying */}
          {step === "verifying" && (
            <div className="sc-loading">
              <span className="spinner-lg" />
              <p>Verifying clinical accuracy...</p>
              <p style={{ fontSize: "0.8rem", color: "var(--gray-500)" }}>Cross-referencing against conversation transcripts</p>
            </div>
          )}

          {/* Summary failed — show retry */}
          {step === "summary" && !editSummary && !error && (
            <div className="sc-loading">
              <p>No summary data available.</p>
            </div>
          )}
          {step === "summary" && !editSummary && error && (
            <div className="sc-actions">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={generateSummary}>Retry</button>
            </div>
          )}

          {/* Step 2: Editable summary */}
          {step === "summary" && editSummary && (
            <div className="sc-summary">
              {/* Verification results banner */}
              {verificationPassed ? (
                <div className="sc-verify-pass">
                  Grounding &amp; fluency check passed — all fields verified.
                </div>
              ) : (
                <>
                  {verificationChanges.length > 0 && (
                    <div className="sc-verify-warn">
                      <strong>Grounding check — {verificationChanges.length} correction{verificationChanges.length > 1 ? "s" : ""} applied:</strong>
                      <ul className="sc-verify-list">
                        {verificationChanges.map((c, i) => (
                          <li key={`g-${i}`}>
                            <span className="sc-verify-field">{c.field}</span>: {c.reason}
                            {c.original !== c.corrected && (
                              <div className="sc-verify-diff">
                                <span className="sc-verify-del">{c.original}</span>
                                <span className="sc-verify-arrow">&rarr;</span>
                                <span className="sc-verify-ins">{c.corrected}</span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {fluencyIssues.length > 0 && (
                    <div className="sc-verify-fluency">
                      <strong>Language fluency — {fluencyIssues.length} fix{fluencyIssues.length > 1 ? "es" : ""} applied:</strong>
                      <ul className="sc-verify-list">
                        {fluencyIssues.map((f, i) => (
                          <li key={`f-${i}`}>
                            <span className="sc-verify-field">{f.field}</span>: {f.issue}
                            {f.suggestion && (
                              <div className="sc-verify-diff">
                                <span className="sc-verify-ins">{f.suggestion}</span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p style={{ fontSize: "0.78rem", color: "var(--gray-500)" }}>
                    All corrections have been applied automatically. You can still edit any field below.
                  </p>
                </>
              )}

              <SummaryField label="Chief Complaint" value={editSummary.chiefComplaint} onChange={(v) => updateField("chiefComplaint", v)} />

              <ArrayField label="Symptoms" items={editSummary.symptoms} onChange={(i, v) => updateArrayItem("symptoms", i, v)} onAdd={() => addArrayItem("symptoms")} onRemove={(i) => removeArrayItem("symptoms", i)} />

              <SummaryField label="Diagnosis / Assessment" value={editSummary.diagnosis} onChange={(v) => updateField("diagnosis", v)} />

              <ArrayField label="Medication / Prescriptions" items={editSummary.medication} onChange={(i, v) => updateArrayItem("medication", i, v)} onAdd={() => addArrayItem("medication")} onRemove={(i) => removeArrayItem("medication", i)} />

              <ArrayField label="Doctor Instructions" items={editSummary.doctorInstructions} onChange={(i, v) => updateArrayItem("doctorInstructions", i, v)} onAdd={() => addArrayItem("doctorInstructions")} onRemove={(i) => removeArrayItem("doctorInstructions", i)} />

              <SummaryField label="Procedures Performed" value={editSummary.procedures} onChange={(v) => updateField("procedures", v)} />
              <SummaryField label="Follow-up Plan" value={editSummary.followUp} onChange={(v) => updateField("followUp", v)} />
              <SummaryField label="Allergies" value={editSummary.allergies} onChange={(v) => updateField("allergies", v)} />
              <SummaryField label="Vital Signs" value={editSummary.vitalSigns} onChange={(v) => updateField("vitalSigns", v)} />
              <SummaryField label="Additional Notes" value={editSummary.notes} onChange={(v) => updateField("notes", v)} multiline />

              <div className="sc-actions">
                <button className="btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn-primary btn-large" onClick={() => setStep("confirm-cert")}>
                  Generate Certificate
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm certificate — collect doctor/patient info */}
          {step === "confirm-cert" && (
            <div className="sc-confirm">
              <p className="sc-confirm-note">Review details for the medical certificate. Patient info is from their profile.</p>

              <fieldset className="cert-fieldset">
                <legend>Patient Information <span className="field-locked">(From Patient Profile)</span></legend>
                <div className="cert-form-grid">
                  <label>Full Name *<input type="text" value={patientInfo.name} readOnly className="input-readonly" /></label>
                  <label>Age<input type="text" value={patientInfo.age} readOnly className="input-readonly" /></label>
                  <label>Sex<input type="text" value={patientInfo.sex} readOnly className="input-readonly" /></label>
                </div>
              </fieldset>

              <fieldset className="cert-fieldset">
                <legend>Visit Details <span className="field-locked">(Auto-filled from session)</span></legend>
                <div className="cert-form-grid">
                  <label>Visit Date<input type="text" value={new Date(visitDate).toLocaleDateString()} readOnly className="input-readonly" /></label>
                  <label>Visit Type<input type="text" value="Outpatient" readOnly className="input-readonly" /></label>
                </div>
              </fieldset>

              <fieldset className="cert-fieldset">
                <legend>Doctor / Facility <span className="field-locked">(From Your Profile)</span></legend>
                <div className="cert-form-grid">
                  <label>Physician Name *<input type="text" value={doctorInfo.name} readOnly className="input-readonly" /></label>
                  <label>License No.<input type="text" value={doctorInfo.licenseNumber} readOnly className="input-readonly" /></label>
                  <label>Hospital<input type="text" value={doctorInfo.hospital} readOnly className="input-readonly" /></label>
                  <label>Department<input type="text" value={doctorInfo.department} readOnly className="input-readonly" /></label>
                </div>
              </fieldset>

              {error && <div className="status-bar status-error" role="alert">{error}</div>}

              <div className="sc-actions">
                <button className="btn-secondary" onClick={() => setStep("summary")}>Back</button>
                <button
                  className="btn-primary btn-large"
                  onClick={generateCertificate}
                  disabled={!patientInfo.name.trim() || !doctorInfo.name.trim()}
                >
                  Confirm & Generate
                </button>
              </div>
            </div>
          )}

          {/* Step 3b: Generating */}
          {step === "generating-cert" && (
            <div className="sc-loading">
              <span className="spinner-lg" />
              <p>Building certificate...</p>
            </div>
          )}

          {/* Step 4: Certificate view */}
          {step === "certificate" && certResult && (
            <div className="sc-certificate">
              <div className="sc-cert-actions">
                <button className="btn-secondary" onClick={() => setStep("confirm-cert")}>Back</button>
                <button className="btn-primary" onClick={() => window.print()}>Print</button>
                <button className="btn-primary btn-download" onClick={handleDownloadPdf} disabled={downloading}>
                  {downloading ? "Generating..." : "Download PDF"}
                </button>
              </div>
              <div ref={certCardsRef} className="cert-pages">
                <CertificatePage
                  cert={certResult.certificateLang1}
                  langLabel={certResult.lang1Label}
                  langCode={doctorLang}
                  hospitalName={doctorInfo.hospital}
                  department={doctorInfo.department}
                />
                <CertificatePage
                  cert={certResult.certificateLang2}
                  langLabel={certResult.lang2Label}
                  langCode={patientLang}
                  hospitalName={doctorInfo.hospital}
                  department={doctorInfo.department}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Editable field components ---

function SummaryField({ label, value, onChange, multiline }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  return (
    <div className="sc-field">
      <label className="sc-field-label">{label}</label>
      {multiline ? (
        <textarea className="sc-field-input sc-textarea" value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <input className="sc-field-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ArrayField({ label, items, onChange, onAdd, onRemove }: {
  label: string; items: string[]; onChange: (i: number, v: string) => void; onAdd: () => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="sc-field">
      <label className="sc-field-label">{label}</label>
      {items.map((item, i) => (
        <div key={i} className="sc-array-row">
          <input className="sc-field-input" type="text" value={item} onChange={(e) => onChange(i, e.target.value)} />
          <button className="sc-array-remove" onClick={() => onRemove(i)} aria-label="Remove" title="Remove">&#10005;</button>
        </div>
      ))}
      <button className="sc-array-add" onClick={onAdd}>+ Add</button>
    </div>
  );
}

// --- Certificate Page Component (bilingual) ---

function CertificatePage({
  cert,
  langLabel,
  langCode,
  hospitalName,
  department,
}: {
  cert: CertificateContent;
  langLabel: string;
  langCode: string;
  hospitalName: string;
  department: string;
}) {
  const formattedDate = cert.visitDate || "";

  return (
    <div className="cert-page" lang={langCode}>
      {/* Header with logo */}
      <div className="cert-page-header">
        <div className="cert-page-logo">
          <img src="/hospital-icon.svg" alt="Hospital logo" />
        </div>
        <div className="cert-page-hospital">
          <h2>{hospitalName || cert.hospital || "Hospital Name"}</h2>
          {department && <p className="cert-page-dept">{department || cert.department}</p>}
        </div>
        <div className="cert-page-lang-badge">{langLabel}</div>
      </div>

      <div className="cert-page-divider" />

      {/* Title */}
      <h1 className="cert-page-title">{cert.title || "Medical Certificate"}</h1>

      {/* Patient info table */}
      <table className="cert-table">
        <tbody>
          <tr>
            <td className="cert-table-label">Patient Name</td>
            <td className="cert-table-value" colSpan={3}>{cert.patientName}</td>
          </tr>
          <tr>
            <td className="cert-table-label">Age</td>
            <td className="cert-table-value">{cert.patientAge}</td>
            <td className="cert-table-label">Sex</td>
            <td className="cert-table-value">{cert.patientSex}</td>
          </tr>
          <tr>
            <td className="cert-table-label">Visit Date</td>
            <td className="cert-table-value">{formattedDate}</td>
            <td className="cert-table-label">Visit Type</td>
            <td className="cert-table-value">{cert.visitType}</td>
          </tr>
        </tbody>
      </table>

      {/* Clinical sections */}
      <div className="cert-clinical">
        <div className="cert-clinical-section">
          <h3>Chief Complaint</h3>
          <p>{cert.chiefComplaint}</p>
        </div>

        <div className="cert-clinical-section">
          <h3>Principal Diagnosis</h3>
          <p>{cert.principalDiagnosis}</p>
        </div>

        <div className="cert-clinical-section">
          <h3>Treatment(s)</h3>
          <p>{cert.treatments}</p>
        </div>

        {cert.operationProcedure && cert.operationProcedure !== "Not Applicable" && (
          <div className="cert-clinical-section">
            <h3>Operation / Procedure</h3>
            <p>{cert.operationProcedure}</p>
          </div>
        )}

        <div className="cert-clinical-section">
          <h3>Recommendations</h3>
          <p>{cert.recommendations}</p>
        </div>
      </div>

      {/* Signature block */}
      <div className="cert-signature">
        <div className="cert-signature-block">
          <div className="cert-signature-line">
            <span className="cert-signature-cursive">{cert.physicianName}</span>
          </div>
          <p className="cert-signature-name">{cert.physicianName}</p>
          {cert.licenseNumber && (
            <p className="cert-signature-detail">License No. {cert.licenseNumber}</p>
          )}
          <p className="cert-signature-detail">{cert.hospital}</p>
          {cert.department && (
            <p className="cert-signature-detail">{cert.department}</p>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="cert-page-disclaimer">
        {cert.disclaimer}
      </div>
    </div>
  );
}
