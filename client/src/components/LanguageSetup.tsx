import { LANG_OPTIONS, type SupportedLang } from "../types";

interface Props {
  doctorLang: SupportedLang;
  patientLang: SupportedLang;
  setDoctorLang: (lang: SupportedLang) => void;
  setPatientLang: (lang: SupportedLang) => void;
  onConfirm: () => void;
}

export default function LanguageSetup({
  doctorLang,
  patientLang,
  setDoctorLang,
  setPatientLang,
  onConfirm,
}: Props) {
  const isValid = doctorLang !== patientLang;

  return (
    <div className="app">
      <header className="app-header">
        <h1>MedInterpreter</h1>
        <p className="subtitle">Medical Interpretation Assistant</p>
      </header>

      <main className="app-main">
        <div className="lang-setup">
          <h2>Select Languages</h2>
          <p className="lang-setup-desc">
            Choose the language for each party before starting the consultation.
          </p>

          <div className="lang-setup-card lang-setup-doctor">
            <label className="lang-setup-label" htmlFor="setup-doctor-lang">Doctor speaks</label>
            <select
              id="setup-doctor-lang"
              value={doctorLang}
              onChange={(e) => setDoctorLang(e.target.value as SupportedLang)}
              className="lang-setup-select"
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lang-setup-arrow" aria-hidden="true">&#8693;</div>

          <div className="lang-setup-card lang-setup-patient">
            <label className="lang-setup-label" htmlFor="setup-patient-lang">Patient speaks</label>
            <select
              id="setup-patient-lang"
              value={patientLang}
              onChange={(e) => setPatientLang(e.target.value as SupportedLang)}
              className="lang-setup-select"
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {!isValid && (
            <div className="status-bar status-error" role="alert">
              Doctor and patient must speak different languages.
            </div>
          )}

          <button
            className="btn-primary btn-large"
            onClick={onConfirm}
            disabled={!isValid}
          >
            Start Consultation
          </button>
        </div>
      </main>
    </div>
  );
}
