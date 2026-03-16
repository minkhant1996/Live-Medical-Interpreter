import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import type { SharedCertificateData } from "../types";

interface Props {
  certificate: SharedCertificateData;
  myRole: "doctor" | "patient";
  onClose: () => void;
}

export default function CertificateViewerModal({ certificate, myRole, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const certRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDownloadPdf() {
    if (!certRef.current || downloading) return;
    setDownloading(true);
    setError(null);

    try {
      const canvas = await html2canvas(certRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;

      if (imgH > pageH - margin * 2) {
        let y = 0;
        const contentH = pageH - margin * 2;
        while (y < imgH) {
          if (y > 0) pdf.addPage();
          const srcY = (y / imgH) * canvas.height;
          const srcH = Math.min((contentH / imgH) * canvas.height, canvas.height - srcY);
          const dstH = Math.min(contentH, imgH - y);
          const sub = document.createElement("canvas");
          sub.width = canvas.width;
          sub.height = srcH;
          sub.getContext("2d")!.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
          pdf.addImage(sub.toDataURL("image/png"), "PNG", margin, margin, imgW, dstH);
          y += contentH;
        }
      } else {
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, imgW, imgH);
      }

      const safeName = (certificate.patientName || "patient").replace(/[^a-zA-Z0-9]/g, "_");
      pdf.save(`medical_certificate_${safeName}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setError("Failed to generate PDF. Try using the Print button instead.");
    } finally {
      setDownloading(false);
    }
  }

  const today = certificate.visitDate || new Date().toISOString().split("T")[0];

  return (
    <div className="sc-overlay">
      <div className="sc-modal" role="dialog" aria-label="Medical Certificate">
        {/* Header */}
        <div className="sc-header">
          <h2>Medical Certificate</h2>
          <button className="sc-close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="sc-body">
          {error && (
            <div className="status-bar status-error" role="alert">
              {error}
              <button className="btn-dismiss" onClick={() => setError(null)}>&#10005;</button>
            </div>
          )}

          {/* Info banner for patient */}
          {myRole === "patient" && (
            <div className="cert-info-banner">
              Your doctor has generated a medical certificate for this consultation.
              You can download it as a PDF for your records.
            </div>
          )}

          {/* Certificate actions */}
          <div className="sc-cert-actions">
            <button className="btn-primary" onClick={() => window.print()}>
              Print
            </button>
            <button
              className="btn-primary btn-download"
              onClick={handleDownloadPdf}
              disabled={downloading}
            >
              {downloading ? "Generating..." : "Download PDF"}
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>

          {/* Certificate template */}
          <div ref={certRef} className="cert-page">
            {/* Header with logo */}
            <div className="cert-page-header">
              <div className="cert-page-logo">
                <img src="/hospital-icon.svg" alt="Hospital logo" />
              </div>
              <div className="cert-page-hospital">
                <h2>Medical Consultation Certificate</h2>
                <p className="cert-page-dept">Medical Interpreter Service</p>
              </div>
            </div>

            <div className="cert-page-divider" />

            {/* Title */}
            <h1 className="cert-page-title">Medical Certificate</h1>

            {/* Patient info table */}
            <table className="cert-table">
              <tbody>
                <tr>
                  <td className="cert-table-label">Patient Name</td>
                  <td className="cert-table-value" colSpan={3}>{certificate.patientName}</td>
                </tr>
                <tr>
                  <td className="cert-table-label">Visit Date</td>
                  <td className="cert-table-value">{today}</td>
                  <td className="cert-table-label">Doctor</td>
                  <td className="cert-table-value">{certificate.doctorName}</td>
                </tr>
              </tbody>
            </table>

            {/* Clinical sections */}
            <div className="cert-clinical">
              <div className="cert-clinical-section">
                <h3>Chief Complaint</h3>
                <p>{certificate.summary.chiefComplaint || "Not recorded"}</p>
              </div>

              <div className="cert-clinical-section">
                <h3>Diagnosis</h3>
                <p>{certificate.summary.diagnosis || "Not recorded"}</p>
              </div>

              {certificate.summary.symptoms.length > 0 && (
                <div className="cert-clinical-section">
                  <h3>Symptoms</h3>
                  <p>{certificate.summary.symptoms.join(", ")}</p>
                </div>
              )}

              {certificate.summary.medication.length > 0 && (
                <div className="cert-clinical-section">
                  <h3>Medication / Treatment</h3>
                  <p>{certificate.summary.medication.join(", ")}</p>
                </div>
              )}

              {certificate.summary.doctorInstructions.length > 0 && (
                <div className="cert-clinical-section">
                  <h3>Doctor Instructions</h3>
                  <p>{certificate.summary.doctorInstructions.join(". ")}</p>
                </div>
              )}

              {certificate.summary.followUp && (
                <div className="cert-clinical-section">
                  <h3>Follow-Up</h3>
                  <p>{certificate.summary.followUp}</p>
                </div>
              )}
            </div>

            {/* Signature block */}
            <div className="cert-signature">
              <div className="cert-signature-block">
                <div className="cert-signature-line">
                  <span className="cert-signature-cursive">{certificate.doctorName}</span>
                </div>
                <p className="cert-signature-name">{certificate.doctorName}</p>
                <p className="cert-signature-detail">Attending Physician</p>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="cert-page-disclaimer">
              This certificate was generated using AI-assisted medical interpretation.
              It is provided for informational purposes only and should be verified by qualified medical personnel.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
