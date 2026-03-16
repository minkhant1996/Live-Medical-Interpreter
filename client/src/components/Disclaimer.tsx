import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { modalBackdrop, modalContent, staggerContainer, fadeInUp, checkmarkAppear, buttonHover, buttonTap } from "../utils/motion";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  onDismiss: () => void;
}

export default function Disclaimer({ onDismiss }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shouldReduceMotion = useReducedMotion();

  // Focus trap: keep focus inside the disclaimer modal
  useEffect(() => {
    buttonRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        // Only one focusable element, keep focus there
        e.preventDefault();
        buttonRef.current?.focus();
      }
      if (e.key === "Escape") {
        // Don't allow escape to dismiss — user must explicitly accept
        e.preventDefault();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        className="disclaimer-overlay"
        role="presentation"
        variants={shouldReduceMotion ? {} : modalBackdrop}
        initial="hidden"
        animate="visible"
        exit="exit"
        style={{ backdropFilter: shouldReduceMotion ? "none" : "blur(4px)" }}
      >
        <motion.div
          ref={dialogRef}
          className="disclaimer-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-title"
          aria-describedby="disclaimer-body"
          variants={shouldReduceMotion ? {} : modalContent}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div
            className="disclaimer-icon"
            aria-hidden="true"
            variants={shouldReduceMotion ? {} : checkmarkAppear}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.2 }}
          >
            &#9888;
          </motion.div>

          <motion.div
            variants={shouldReduceMotion ? {} : staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.h2
              id="disclaimer-title"
              variants={shouldReduceMotion ? {} : fadeInUp}
            >
              Important Notice
            </motion.h2>

            <motion.div
              className="disclaimer-body"
              id="disclaimer-body"
              variants={shouldReduceMotion ? {} : fadeInUp}
            >
              <p>
                <strong>MedInterpreter</strong> is a <strong>communication support tool</strong> designed
                to help bridge language barriers between healthcare providers and
                patients.
              </p>
              <ul>
                <li>This is <strong>NOT</strong> a medical device</li>
                <li>This does <strong>NOT</strong> provide medical diagnosis</li>
                <li>This does <strong>NOT</strong> replace professional medical interpreters</li>
                <li>Translations may contain errors - always verify critical information</li>
              </ul>
              <p className="red-flag">
                <strong>If you are experiencing a medical emergency, call your local emergency number immediately.</strong>
              </p>
            </motion.div>

            <motion.button
              ref={buttonRef}
              className="btn-primary btn-large"
              onClick={onDismiss}
              variants={shouldReduceMotion ? {} : fadeInUp}
              whileHover={shouldReduceMotion ? {} : buttonHover}
              whileTap={shouldReduceMotion ? {} : buttonTap}
            >
              I Understand - Continue
            </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
