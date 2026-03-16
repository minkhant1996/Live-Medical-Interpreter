import { motion } from "framer-motion";
import { fadeInUp, slideInFromLeft, staggerContainer } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  page: "terms" | "privacy";
  onBack: () => void;
}

export default function LegalPage({ page, onBack }: Props) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="app">
      <header className="app-header">
        <h1>MedInterpreter</h1>
        <p className="subtitle">Medical Interpretation Assistant</p>
      </header>

      <main className="app-main">
        <motion.button
          className="btn-link legal-back"
          onClick={onBack}
          variants={shouldReduceMotion ? {} : slideInFromLeft}
          initial="hidden"
          animate="visible"
          whileHover={shouldReduceMotion ? {} : { x: -4 }}
        >
          &larr; Back
        </motion.button>

        {page === "terms" ? <TermsContent shouldReduceMotion={shouldReduceMotion} /> : <PrivacyContent shouldReduceMotion={shouldReduceMotion} />}
      </main>

      <footer className="app-footer">
        <p>
          Communication support tool only. Not a medical device or diagnostic
          tool.
        </p>
      </footer>
    </div>
  );
}

function TermsContent({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  const sections = [
    {
      id: "acceptance",
      title: "1. Acceptance of Terms",
      content: `By accessing or using MedInterpreter ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.`,
    },
    {
      id: "description",
      title: "2. Description of Service",
      content: `MedInterpreter is a communication support tool designed to assist with language interpretation in medical settings. It uses AI-powered translation and transcription.`,
    },
    // More sections...
  ];

  return (
    <motion.div
      className="legal-content"
      variants={shouldReduceMotion ? {} : staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.h2 variants={shouldReduceMotion ? {} : fadeInUp}>Terms of Service</motion.h2>
      <motion.p className="legal-updated" variants={shouldReduceMotion ? {} : fadeInUp}>Last updated: March 2026</motion.p>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>1. Acceptance of Terms</h3>
        <p>
          By accessing or using MedInterpreter ("the Service"), you agree to be
          bound by these Terms of Service. If you do not agree, do not use the
          Service.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>2. Description of Service</h3>
        <p>
          MedInterpreter is a <strong>communication support tool</strong>{" "}
          designed to assist with language interpretation in medical settings. It
          uses AI-powered translation and transcription.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>3. Medical Disclaimer</h3>
        <p>The Service is:</p>
        <ul>
          <li>
            <strong>NOT</strong> a medical device or diagnostic tool
          </li>
          <li>
            <strong>NOT</strong> a substitute for professional medical
            interpreters
          </li>
          <li>
            <strong>NOT</strong> intended to provide medical advice, diagnosis,
            or treatment
          </li>
        </ul>
        <p>
          Translations may contain errors. All critical medical information must
          be verified independently by qualified healthcare professionals. Do not
          rely solely on this Service for medical decisions.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>4. No Warranty</h3>
        <p>
          The Service is provided "as is" and "as available" without warranties
          of any kind, whether express or implied, including but not limited to
          accuracy of translations, availability, or fitness for a particular
          purpose.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>5. Limitation of Liability</h3>
        <p>
          To the maximum extent permitted by law, the creators of MedInterpreter
          shall not be liable for any direct, indirect, incidental, special, or
          consequential damages arising from the use or inability to use the
          Service, including but not limited to damages arising from translation
          errors or medical decisions based on the Service's output.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>6. User Responsibilities</h3>
        <ul>
          <li>
            You are responsible for verifying all translations and medical
            information
          </li>
          <li>
            You must not use the Service as the sole means of communication in
            life-threatening situations
          </li>
          <li>
            You must comply with all applicable laws regarding patient privacy
            and medical data
          </li>
          <li>
            You must not attempt to abuse, overload, or interfere with the
            Service
          </li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>7. Data Handling</h3>
        <p>
          Audio and text submitted to the Service are processed in real time for
          translation purposes. See our{" "}
          <strong>Privacy Policy</strong> for details on data handling.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>8. Open Source License</h3>
        <p>
          MedInterpreter is open-source software released under the{" "}
          <strong>MIT License</strong>. You may use, modify, and distribute the
          source code in accordance with that license. The MIT License's
          limitation of liability applies in addition to these Terms.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>9. Changes to Terms</h3>
        <p>
          We may update these Terms at any time. Continued use of the Service
          after changes constitutes acceptance of the updated Terms.
        </p>
      </motion.section>
    </motion.div>
  );
}

function PrivacyContent({ shouldReduceMotion }: { shouldReduceMotion: boolean }) {
  return (
    <motion.div
      className="legal-content"
      variants={shouldReduceMotion ? {} : staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.h2 variants={shouldReduceMotion ? {} : fadeInUp}>Privacy Policy</motion.h2>
      <motion.p className="legal-updated" variants={shouldReduceMotion ? {} : fadeInUp}>Last updated: March 2026</motion.p>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>1. Overview</h3>
        <p>
          MedInterpreter is designed with privacy in mind. This policy explains
          what data is collected, how it is used, and how it is protected.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>2. Data We Process</h3>
        <p>When you use the Service, the following data is processed:</p>
        <ul>
          <li>
            <strong>Audio data:</strong> Voice input streamed for real-time
            transcription and translation
          </li>
          <li>
            <strong>Text input:</strong> Typed messages submitted for
            translation
          </li>
          <li>
            <strong>Prescription images:</strong> Photos uploaded for analysis
            (Rx Scan feature)
          </li>
          <li>
            <strong>Certificate form data:</strong> Patient and doctor
            information entered for certificate generation
          </li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>3. How Data Is Used</h3>
        <p>
          All data is processed <strong>solely</strong> for the purpose of
          providing translation, transcription, and document generation services.
          Data is:
        </p>
        <ul>
          <li>
            Processed by AI services for translation and transcription
          </li>
          <li>Converted to speech using text-to-speech services</li>
          <li>Not used for training AI models by MedInterpreter</li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>4. Data Retention</h3>
        <ul>
          <li>
            <strong>Session data:</strong> Conversation transcripts exist only
            in your browser session. They are not stored on our servers.
          </li>
          <li>
            <strong>Audio streams:</strong> Processed in real time and not
            persisted on our servers after the session ends
          </li>
          <li>
            <strong>Server-side cleanup:</strong> Any temporary data held during
            a WebSocket session is cleared when you disconnect
          </li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>5. Third-Party Services</h3>
        <p>The Service uses the following types of third-party services:</p>
        <ul>
          <li>
            <strong>AI Translation Services</strong> — for translation, transcription,
            summarization, and image analysis
          </li>
          <li>
            <strong>Text-to-Speech Services</strong> — for generating spoken
            translations
          </li>
          <li>
            <strong>Cloud Hosting Services</strong> — for hosting the application
          </li>
        </ul>
        <p>
          These services have their own privacy policies. Data sent to these
          services is subject to their respective terms.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>6. Data Security</h3>
        <p>We implement the following security measures:</p>
        <ul>
          <li>HTTPS/WSS encrypted connections</li>
          <li>Rate limiting to prevent abuse</li>
          <li>Input sanitization to prevent injection attacks</li>
          <li>No persistent storage of health information</li>
          <li>Automatic session cleanup on disconnect</li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>7. No Cookies or Tracking</h3>
        <p>
          MedInterpreter does not use cookies, analytics trackers, or
          advertising. No personal identifiers are collected beyond what you
          explicitly enter during a session.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>8. Health Data (PHI) Notice</h3>
        <p>
          This Service may process information that could constitute Protected
          Health Information (PHI). By using the Service, you acknowledge that:
        </p>
        <ul>
          <li>
            The Service is <strong>not HIPAA compliant</strong>
          </li>
          <li>
            You are responsible for compliance with applicable health data
            regulations in your jurisdiction
          </li>
          <li>
            You should not enter more personal health information than necessary
            for the translation task
          </li>
        </ul>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>9. Your Rights</h3>
        <p>
          Since we do not persistently store your data, there is no personal data
          to access, correct, or delete after your session ends. During a
          session, you can clear your conversation transcript at any time.
        </p>
      </motion.section>

      <motion.section variants={shouldReduceMotion ? {} : fadeInUp}>
        <h3>10. Contact</h3>
        <p>
          For questions about this Privacy Policy, please open an issue on the
          project's GitHub repository.
        </p>
      </motion.section>
    </motion.div>
  );
}
