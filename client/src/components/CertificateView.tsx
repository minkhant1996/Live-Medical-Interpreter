import { useRef, useState, useEffect } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import type {
  TranscriptEntry,
  SupportedLang,
  CertificateResponse,
  CertificateContent,
  AuthUser,
  DoctorProfile,
  PatientProfile,
  RoomInfo,
} from "../types";
import { getLangLabel } from "../types";

interface Props {
  transcripts: TranscriptEntry[];
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  user?: AuthUser;
  participantProfile?: DoctorProfile | PatientProfile | null;
  roomCreatedAt?: string; // ISO date string from room creation
  cachedCertificate?: CertificateResponse | null;
  onCertificateGenerated?: (cert: CertificateResponse) => void;
  room?: RoomInfo | null;
}

export default function CertificateView({
  transcripts,
  doctorLang,
  patientLang,
  user,
  participantProfile,
  roomCreatedAt,
  cachedCertificate,
  onCertificateGenerated,
  room,
}: Props) {
  // Use cached certificate if available
  const [localResult, setLocalResult] = useState<CertificateResponse | null>(null);
  const [showForm, setShowForm] = useState(!cachedCertificate);
  const result = showForm ? null : (cachedCertificate || localResult);

  // Update showForm when cachedCertificate changes
  useEffect(() => {
    if (cachedCertificate) {
      setShowForm(false);
    }
  }, [cachedCertificate]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedLang, setSelectedLang] = useState<1 | 2>(1); // 1 = doctor lang, 2 = patient lang
  const certCardsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Default logo - hospital icon
  const logoUrl = "/hospital-icon.svg";

  // Patient info - only name, age, sex (no confidential data like ID/nationality)
  const [patientInfo, setPatientInfo] = useState({
    name: "",
    age: "",
    sex: "Male",
  });

  const [doctorInfo, setDoctorInfo] = useState({
    name: "",
    licenseNumber: "",
    hospital: "",
    department: "",
  });

  // Visit date is auto-set from room creation, not editable
  // Handle both ISO string and Firestore Timestamp object formats
  const visitDate = (() => {
    if (!roomCreatedAt) return new Date().toISOString().split("T")[0];
    try {
      // Handle Firestore Timestamp object format {_seconds, _nanoseconds}
      if (typeof roomCreatedAt === "object" && "_seconds" in (roomCreatedAt as any)) {
        const ts = roomCreatedAt as unknown as { _seconds: number };
        return new Date(ts._seconds * 1000).toISOString().split("T")[0];
      }
      // Handle ISO string format
      return new Date(roomCreatedAt).toISOString().split("T")[0];
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  })();
  const visitType = "outpatient" as const; // Always outpatient for this app

  // Determine which fields should be read-only based on user role
  // Doctors cannot edit patient info (comes from database)
  // Patients cannot edit doctor info (comes from database)
  const patientFieldsReadOnly = user?.role === "doctor";
  const doctorFieldsReadOnly = user?.role === "patient";

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Helper to detect if profile is a DoctorProfile (has doctor-specific fields)
  const isDoctorProfile = (profile: DoctorProfile | PatientProfile): profile is DoctorProfile => {
    return "specialty" in profile || "licenseNumber" in profile;
  };

  // Auto-fill from profiles when component mounts or profiles change
  useEffect(() => {
    console.log("CertificateView auto-fill effect:", {
      userRole: user?.role,
      participantProfile: participantProfile ? JSON.stringify(participantProfile) : null
    });

    if (!user) return;

    if (user.role === "doctor") {
      // Doctor is viewing - their own info goes in doctor fields (from user object)
      setDoctorInfo({
        name: user.displayName || "",
        licenseNumber: user.licenseNumber || "",
        hospital: user.hospital || "",
        department: user.department || "",
      });

      // Patient's info (from participantProfile) goes in patient fields
      // Note: No confidential data (nationality, ID) shown to doctor
      // Detect patient profile by checking it's NOT a doctor profile
      if (participantProfile && !isDoctorProfile(participantProfile)) {
        const patientData = participantProfile as PatientProfile;
        console.log("Auto-filling patient info from profile:", patientData.displayName);
        // Calculate age from dateOfBirth
        let age = "";
        if (patientData.dateOfBirth) {
          const birthDate = new Date(patientData.dateOfBirth);
          const today = new Date();
          age = String(Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
        }
        // Map gender to sex display
        const sex = patientData.gender === "female" ? "Female" : patientData.gender === "male" ? "Male" : "Male";
        setPatientInfo({
          name: patientData.displayName || "",
          age,
          sex,
        });
      } else if (participantProfile) {
        console.log("participantProfile detected as doctor profile, skipping patient auto-fill");
      } else {
        console.log("No participantProfile available for auto-fill");
      }
    } else if (user.role === "patient") {
      // Patient is viewing - their info goes in patient fields
      // Calculate age from user's dateOfBirth if available
      let age = "";
      if (user.dateOfBirth) {
        const birthDate = new Date(user.dateOfBirth);
        const today = new Date();
        age = String(Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
      }
      const sex = user.gender === "female" ? "Female" : user.gender === "male" ? "Male" : "Male";
      setPatientInfo({
        name: user.displayName || "",
        age,
        sex,
      });

      // Doctor's info (from participantProfile) goes in doctor fields
      if (participantProfile && isDoctorProfile(participantProfile)) {
        const doctorData = participantProfile;
        console.log("Auto-filling doctor info from profile:", doctorData.displayName);
        setDoctorInfo({
          name: doctorData.displayName || "",
          licenseNumber: doctorData.licenseNumber || "",
          hospital: doctorData.hospital || "",
          department: doctorData.department || "",
        });
      }
    }
  }, [user, participantProfile]);

  async function handleGenerate() {
    if (transcripts.length === 0) {
      setError("No conversation to generate certificate from.");
      return;
    }
    if (!patientInfo.name.trim()) {
      setError("Patient name is required.");
      return;
    }
    if (!doctorInfo.name.trim()) {
      setError("Doctor name is required.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcripts,
          doctorLang,
          patientLang,
          patientInfo,
          doctorInfo,
          visitDate,
          visitType,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to generate certificate");
      }

      const data: CertificateResponse = await res.json();
      console.log("Certificate response:", data);

      // Validate response has content
      if (!data.certificateLang1 || !data.certificateLang2) {
        throw new Error("Certificate data is incomplete");
      }

      setLocalResult(data);
      setShowForm(false);
      onCertificateGenerated?.(data);

      // Save to server if we have room and user (doctor only)
      if (room?.code && user?.token && user?.role === "doctor") {
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
          // Don't show error to user - the certificate was generated successfully
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Certificate generation error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate certificate."
      );
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (downloading) return;

    setDownloading(true);
    setError(null);

    try {
      // Use the print-only container which has both certificates
      const printContainer = document.querySelector<HTMLElement>(".cert-pages-print-only");
      if (!printContainer) {
        throw new Error("Print container not found");
      }
      const cards = printContainer.querySelectorAll<HTMLElement>(".cert-page");
      console.log("Found cert-page elements:", cards.length);

      if (cards.length === 0) {
        throw new Error("No certificate pages found to render");
      }

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

      const patientName = result?.certificateLang1?.patientName || "patient";
      const safeName = patientName.replace(/[^a-zA-Z0-9]/g, "_");
      pdf.save(`medical_certificate_${safeName}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      setError(
        err instanceof Error
          ? `PDF failed: ${err.message}. Try using Print instead.`
          : "Failed to generate PDF. Try using Print instead."
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleEditInfo() {
    setShowForm(true);
    setError(null);
  }

  return (
    <div className="certificate-view">
      <h2>Medical Certificate</h2>
      <p className="cert-desc">
        Generate a bilingual medical certificate in{" "}
        <strong>{getLangLabel(doctorLang)}</strong> and{" "}
        <strong>{getLangLabel(patientLang)}</strong> from the consultation.
      </p>

      {!result ? (
        <>
          <fieldset className="cert-fieldset">
            <legend>Patient Information {patientFieldsReadOnly && <span className="field-locked">(From Patient Profile)</span>}</legend>
            <div className="cert-form-grid">
              <label>
                Full Name *
                <input
                  type="text"
                  value={patientInfo.name}
                  onChange={(e) =>
                    setPatientInfo({ ...patientInfo, name: e.target.value })
                  }
                  placeholder="e.g. John Doe"
                  maxLength={100}
                  aria-required="true"
                  readOnly={patientFieldsReadOnly}
                  className={patientFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
              <label>
                Age
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="150"
                  value={patientInfo.age}
                  onChange={(e) =>
                    setPatientInfo({ ...patientInfo, age: e.target.value })
                  }
                  placeholder="e.g. 29"
                  maxLength={10}
                  readOnly={patientFieldsReadOnly}
                  className={patientFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
              <label>
                Sex
                <select
                  value={patientInfo.sex}
                  onChange={(e) =>
                    setPatientInfo({ ...patientInfo, sex: e.target.value })
                  }
                  disabled={patientFieldsReadOnly}
                  className={patientFieldsReadOnly ? "input-readonly" : ""}
                >
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="cert-fieldset">
            <legend>Doctor / Facility {doctorFieldsReadOnly && <span className="field-locked">(From Doctor Profile)</span>}</legend>
            <div className="cert-form-grid">
              <label>
                Physician Name *
                <input
                  type="text"
                  value={doctorInfo.name}
                  onChange={(e) =>
                    setDoctorInfo({ ...doctorInfo, name: e.target.value })
                  }
                  placeholder="e.g. Dr. Smith"
                  maxLength={100}
                  aria-required="true"
                  readOnly={doctorFieldsReadOnly}
                  className={doctorFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
              <label>
                License No.
                <input
                  type="text"
                  value={doctorInfo.licenseNumber}
                  onChange={(e) =>
                    setDoctorInfo({
                      ...doctorInfo,
                      licenseNumber: e.target.value,
                    })
                  }
                  placeholder="e.g. 13816"
                  maxLength={30}
                  readOnly={doctorFieldsReadOnly}
                  className={doctorFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
              <label>
                Hospital
                <input
                  type="text"
                  value={doctorInfo.hospital}
                  onChange={(e) =>
                    setDoctorInfo({ ...doctorInfo, hospital: e.target.value })
                  }
                  placeholder="e.g. Bangkok Hospital"
                  maxLength={100}
                  readOnly={doctorFieldsReadOnly}
                  className={doctorFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
              <label>
                Department
                <input
                  type="text"
                  value={doctorInfo.department}
                  onChange={(e) =>
                    setDoctorInfo({
                      ...doctorInfo,
                      department: e.target.value,
                    })
                  }
                  placeholder="e.g. ENT Center"
                  maxLength={100}
                  readOnly={doctorFieldsReadOnly}
                  className={doctorFieldsReadOnly ? "input-readonly" : ""}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="cert-fieldset">
            <legend>Visit Details <span className="field-locked">(Auto-filled from session)</span></legend>
            <div className="cert-form-grid">
              <label>
                Visit Date
                <input
                  type="text"
                  value={new Date(visitDate).toLocaleDateString()}
                  readOnly
                  className="input-readonly"
                />
              </label>
              <label>
                Visit Type
                <input
                  type="text"
                  value="Outpatient"
                  readOnly
                  className="input-readonly"
                />
              </label>
            </div>
          </fieldset>

          {error && <div className="status-bar status-error" role="alert">{error}</div>}

          <button
            className="btn-primary btn-large"
            onClick={handleGenerate}
            disabled={loading || transcripts.length === 0}
            aria-label={loading ? "Generating certificate..." : "Generate medical certificate"}
          >
            {loading ? "Generating Certificate..." : "Generate Certificate"}
          </button>

          {transcripts.length === 0 && (
            <p className="summary-empty">
              No conversation recorded. Use the Interpreter tab first.
            </p>
          )}
        </>
      ) : (
        <div className="cert-results">
          <div className="cert-actions">
            <button className="btn-secondary" onClick={handleEditInfo}>
              Edit Info
            </button>
            <button className="btn-primary" onClick={handlePrint} aria-label="Print certificate">
              Print
            </button>
            <button
              className="btn-primary btn-download"
              onClick={handleDownloadPdf}
              disabled={downloading}
              aria-label={downloading ? "Generating PDF..." : "Download certificate as PDF"}
            >
              {downloading ? "Generating..." : "Download PDF"}
            </button>
          </div>

          {/* Language toggle tabs */}
          <div className="cert-lang-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={selectedLang === 1}
              className={`cert-lang-tab ${selectedLang === 1 ? "active" : ""}`}
              onClick={() => setSelectedLang(1)}
            >
              {result.lang1Label}
            </button>
            <button
              role="tab"
              aria-selected={selectedLang === 2}
              className={`cert-lang-tab ${selectedLang === 2 ? "active" : ""}`}
              onClick={() => setSelectedLang(2)}
            >
              {result.lang2Label}
            </button>
          </div>

          {error && <div className="status-bar status-error" role="alert">{error}</div>}

          {/* Show selected language certificate */}
          <div ref={certCardsRef} className="cert-pages">
            {selectedLang === 1 ? (
              <CertificatePage
                cert={result.certificateLang1}
                langLabel={result.lang1Label}
                langCode={doctorLang}
                logoUrl={logoUrl}
                hospitalName={doctorInfo.hospital}
                department={doctorInfo.department}
              />
            ) : (
              <CertificatePage
                cert={result.certificateLang2}
                langLabel={result.lang2Label}
                langCode={patientLang}
                logoUrl={logoUrl}
                hospitalName={doctorInfo.hospital}
                department={doctorInfo.department}
              />
            )}
          </div>

          {/* Hidden: both certificates for PDF download */}
          <div className="cert-pages-print-only" aria-hidden="true">
            <CertificatePage
              cert={result.certificateLang1}
              langLabel={result.lang1Label}
              langCode={doctorLang}
              logoUrl={logoUrl}
              hospitalName={doctorInfo.hospital}
              department={doctorInfo.department}
            />
            <CertificatePage
              cert={result.certificateLang2}
              langLabel={result.lang2Label}
              langCode={patientLang}
              logoUrl={logoUrl}
              hospitalName={doctorInfo.hospital}
              department={doctorInfo.department}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CertificatePage({
  cert,
  langLabel,
  langCode,
  logoUrl,
  hospitalName,
  department,
}: {
  cert: CertificateContent;
  langLabel: string;
  langCode: string;
  logoUrl: string | null;
  hospitalName: string;
  department: string;
}) {
  // Safety check - if cert is missing or empty, show error
  if (!cert || !cert.patientName) {
    return (
      <div className="cert-page" lang={langCode}>
        <div className="status-bar status-error">
          Certificate data is missing or incomplete for {langLabel}.
          Please try generating again.
        </div>
      </div>
    );
  }

  const formattedDate = cert.visitDate || "";

  return (
    <div className="cert-page" lang={langCode}>
      {/* Header with logo */}
      <div className="cert-page-header">
        <div className="cert-page-logo">
          {logoUrl ? (
            <img src={logoUrl} alt="Hospital logo" />
          ) : (
            <div className="cert-logo-placeholder">
              <span>+</span>
              <small>Logo</small>
            </div>
          )}
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
