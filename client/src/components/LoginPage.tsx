import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AuthUser } from "../types";
import { pageEnter, staggerContainerFast, fadeInUp, slideInFromLeft, buttonHover, buttonTap, errorShake, scaleIn } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  onLogin: (user: AuthUser) => void;
}

// Test accounts for quick login
const TEST_ACCOUNTS = {
  admins: [
    { username: "admin", password: "admin123", displayName: "System Admin" },
  ],
  doctors: [
    { username: "dr_smith", password: "doctor123", displayName: "Dr. James Smith", patients: ["patient_aung", "patient_hla", "patient_thida", "patient_kyaw"] },
    { username: "dr_chen", password: "doctor123", displayName: "Dr. Emily Chen", patients: ["patient_thida", "patient_zaw", "patient_hla", "patient_kyaw"] },
    { username: "dr_tanaka", password: "doctor123", displayName: "Dr. Yuki Tanaka", patients: ["patient_zaw", "patient_kyaw", "patient_hla"] },
    { username: "dr_wong", password: "doctor123", displayName: "Dr. Michael Wong", patients: ["patient_thida", "patient_kyaw", "patient_aung", "patient_zaw", "patient_hla"] },
  ],
  patients: [
    { username: "patient_aung", password: "patient123", displayName: "Aung Kyaw Moe", cases: 3 },
    { username: "patient_thida", password: "patient123", displayName: "Thida Win", cases: 4 },
    { username: "patient_zaw", password: "patient123", displayName: "Zaw Min Oo", cases: 4 },
    { username: "patient_hla", password: "patient123", displayName: "Hla Hla Myint", cases: 4 },
    { username: "patient_kyaw", password: "patient123", displayName: "Kyaw Soe Lin", cases: 4 },
  ],
};

export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"doctor" | "patient">("doctor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTestAccounts, setShowTestAccounts] = useState(false);
  const [quickLoggingIn, setQuickLoggingIn] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { username: username.trim(), password };
      if (mode === "register") body.role = role;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");

      onLogin({
        username: data.username,
        role: data.role,
        token: data.token,
        displayName: data.displayName || data.username,
        gender: data.gender,
        // Doctor profile fields for certificate auto-fill
        specialty: data.specialty,
        hospital: data.hospital,
        department: data.department,
        licenseNumber: data.licenseNumber,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function quickLogin(testUsername: string, testPassword: string) {
    setQuickLoggingIn(testUsername);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quick login failed");

      onLogin({
        username: data.username,
        role: data.role,
        token: data.token,
        displayName: data.displayName || data.username,
        gender: data.gender,
        // Doctor profile fields for certificate auto-fill
        specialty: data.specialty,
        hospital: data.hospital,
        department: data.department,
        licenseNumber: data.licenseNumber,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quick login failed");
    } finally {
      setQuickLoggingIn(null);
    }
  }

  return (
    <div className="app">
      <motion.header
        className="app-header"
        variants={shouldReduceMotion ? {} : pageEnter}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.1 }}
        >
          MedInterpreter
        </motion.h1>
        <motion.p
          className="subtitle"
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.2 }}
        >
          Real-time Medical Interpretation
        </motion.p>
      </motion.header>

      <main className="app-main">
        <motion.div
          className="login-card"
          variants={shouldReduceMotion ? {} : scaleIn}
          initial="hidden"
          animate="visible"
        >
          <motion.h2
            variants={shouldReduceMotion ? {} : fadeInUp}
            initial="hidden"
            animate="visible"
          >
            {mode === "login" ? "Sign In" : "Create Account"}
          </motion.h2>

          <motion.form
            onSubmit={handleSubmit}
            variants={shouldReduceMotion ? {} : staggerContainerFast}
            initial="hidden"
            animate="visible"
          >
            <motion.label
              className="login-field"
              variants={shouldReduceMotion ? {} : slideInFromLeft}
            >
              Username
              <motion.input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. dr_smith"
                maxLength={30}
                autoComplete="username"
                required
                whileFocus={shouldReduceMotion ? {} : { scale: 1.01, boxShadow: "var(--glow-blue)" }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              />
            </motion.label>

            <motion.label
              className="login-field"
              variants={shouldReduceMotion ? {} : slideInFromLeft}
            >
              Password
              <motion.input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                whileFocus={shouldReduceMotion ? {} : { scale: 1.01, boxShadow: "var(--glow-blue)" }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              />
            </motion.label>

            {mode === "register" && (
              <motion.label
                className="login-field"
                variants={shouldReduceMotion ? {} : slideInFromLeft}
              >
                I am a...
                <div className="login-role-select">
                  <motion.button
                    type="button"
                    className={`login-role-btn login-role-doctor ${role === "doctor" ? "active" : ""}`}
                    onClick={() => setRole("doctor")}
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02, y: -2 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                    animate={{
                      borderColor: role === "doctor" ? "var(--medical-blue-500)" : "var(--warm-gray-200)",
                      backgroundColor: role === "doctor" ? "var(--medical-blue-50)" : "white",
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <motion.span
                      initial={false}
                      animate={{ scale: role === "doctor" ? 1 : 0, opacity: role === "doctor" ? 1 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      style={{ display: "inline-block", marginRight: role === "doctor" ? "6px" : "0" }}
                    >
                      ✓
                    </motion.span>
                    Doctor
                  </motion.button>
                  <motion.button
                    type="button"
                    className={`login-role-btn login-role-patient ${role === "patient" ? "active" : ""}`}
                    onClick={() => setRole("patient")}
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02, y: -2 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                    animate={{
                      borderColor: role === "patient" ? "var(--healing-teal-500)" : "var(--warm-gray-200)",
                      backgroundColor: role === "patient" ? "var(--healing-teal-50)" : "white",
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <motion.span
                      initial={false}
                      animate={{ scale: role === "patient" ? 1 : 0, opacity: role === "patient" ? 1 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      style={{ display: "inline-block", marginRight: role === "patient" ? "6px" : "0" }}
                    >
                      ✓
                    </motion.span>
                    Patient
                  </motion.button>
                </div>
              </motion.label>
            )}

            {error && (
              <motion.div
                className="status-bar status-error"
                role="alert"
                variants={shouldReduceMotion ? {} : fadeInUp}
                animate={shouldReduceMotion ? {} : errorShake}
              >
                {error}
              </motion.div>
            )}

            <motion.button
              type="submit"
              className="btn-primary btn-large"
              disabled={loading || !username.trim() || !password.trim()}
              variants={shouldReduceMotion ? {} : slideInFromLeft}
              whileHover={shouldReduceMotion || loading ? {} : buttonHover}
              whileTap={shouldReduceMotion || loading ? {} : buttonTap}
            >
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
            </motion.button>
          </motion.form>

          <motion.p
            className="login-switch"
            variants={shouldReduceMotion ? {} : fadeInUp}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.3 }}
          >
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              className="btn-link"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </motion.p>
        </motion.div>

        {/* Quick Login Section for Testing */}
        <motion.div
          className="test-accounts-section"
          variants={shouldReduceMotion ? {} : fadeInUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.35 }}
        >
          <button
            className="test-accounts-toggle"
            onClick={() => setShowTestAccounts(!showTestAccounts)}
          >
            {showTestAccounts ? "Hide" : "Show"} Test Accounts
            <span className={`toggle-arrow ${showTestAccounts ? "open" : ""}`}>▼</span>
          </button>

          <AnimatePresence>
            {showTestAccounts && (
              <motion.div
                className="test-accounts-panel"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Admin Section */}
                <div className="test-accounts-group">
                  <h4 className="test-accounts-title admin">
                    <span className="role-dot admin"></span>
                    Admin
                  </h4>
                  <div className="test-accounts-grid">
                    {TEST_ACCOUNTS.admins.map((admin) => (
                      <motion.button
                        key={admin.username}
                        className="quick-login-btn admin"
                        onClick={() => quickLogin(admin.username, admin.password)}
                        disabled={quickLoggingIn !== null}
                        whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                        whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                      >
                        {quickLoggingIn === admin.username ? (
                          <span className="loading-spinner small"></span>
                        ) : (
                          <>
                            <span className="quick-login-name">{admin.displayName}</span>
                            <span className="quick-login-meta">Analytics Dashboard</span>
                          </>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Patients Section */}
                <div className="test-accounts-group">
                  <h4 className="test-accounts-title patient">
                    <span className="role-dot patient"></span>
                    Patients
                  </h4>
                  <div className="test-accounts-grid">
                    {TEST_ACCOUNTS.patients.map((patient) => (
                      <motion.button
                        key={patient.username}
                        className="quick-login-btn patient"
                        onClick={() => quickLogin(patient.username, patient.password)}
                        disabled={quickLoggingIn !== null}
                        whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                        whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                      >
                        {quickLoggingIn === patient.username ? (
                          <span className="loading-spinner small"></span>
                        ) : (
                          <>
                            <span className="quick-login-name">{patient.displayName}</span>
                            <span className="quick-login-meta">{patient.cases} cases</span>
                          </>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Doctors Section */}
                <div className="test-accounts-group">
                  <h4 className="test-accounts-title doctor">
                    <span className="role-dot doctor"></span>
                    Doctors
                  </h4>
                  <div className="test-accounts-grid">
                    {TEST_ACCOUNTS.doctors.map((doctor) => (
                      <motion.button
                        key={doctor.username}
                        className="quick-login-btn doctor"
                        onClick={() => quickLogin(doctor.username, doctor.password)}
                        disabled={quickLoggingIn !== null}
                        whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                        whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                      >
                        {quickLoggingIn === doctor.username ? (
                          <span className="loading-spinner small"></span>
                        ) : (
                          <>
                            <span className="quick-login-name">{doctor.displayName}</span>
                            <span className="quick-login-meta">{doctor.patients.length} patients</span>
                          </>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                <p className="test-accounts-hint">
                  Click any button to instantly log in as that user
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </main>
    </div>
  );
}
