/**
 * Motion Design System
 * Centralized animation configurations for consistent, accessible animations
 */

import type { Transition, Variants } from "framer-motion";

// ============================================================================
// SPRING CONFIGURATIONS
// ============================================================================

export const motionConfig = {
  spring: {
    type: "spring" as const,
    stiffness: 400,
    damping: 25,
  },
  gentle: {
    type: "spring" as const,
    stiffness: 300,
    damping: 30,
  },
  bouncy: {
    type: "spring" as const,
    stiffness: 500,
    damping: 20,
  },
  tween: {
    type: "tween" as const,
    duration: 0.2,
    ease: "easeOut" as const,
  },
};

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

export const slideInFromRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
};

export const slideInFromLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

export const staggerContainerFast: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

// ============================================================================
// BUTTON INTERACTIONS
// ============================================================================

export const buttonHover = {
  scale: 1.02,
  transition: motionConfig.spring,
};

export const buttonTap = {
  scale: 0.98,
};

export const iconButtonHover = {
  scale: 1.08,
  rotate: 5,
  transition: motionConfig.bouncy,
};

export const iconButtonTap = {
  scale: 0.92,
  rotate: -5,
};

// ============================================================================
// MODAL ANIMATIONS
// ============================================================================

export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const modalContent: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 40 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: motionConfig.gentle,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
};

// ============================================================================
// CARD ANIMATIONS
// ============================================================================

export const cardHoverLift = {
  y: -4,
  boxShadow: "var(--shadow-lg)",
  transition: { duration: 0.15 },
};

// ============================================================================
// PAGE TRANSITIONS
// ============================================================================

export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: { duration: 0.2 },
  },
};

// ============================================================================
// LOADING STATES
// ============================================================================

export const pulseAnimation = {
  scale: [1, 1.08, 1],
  transition: {
    duration: 1.8,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
};

export const breathingGlow = (color: string) => ({
  boxShadow: [
    `0 0 0 0 ${color}`,
    `0 0 0 12px ${color.replace('0.4', '0')}`,
    `0 0 0 0 ${color}`,
  ],
  transition: {
    duration: 1.8,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
});

export const skeletonPulse: Variants = {
  hidden: { opacity: 0.4 },
  visible: {
    opacity: [0.4, 0.7, 0.4],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

// ============================================================================
// TYPING INDICATOR
// ============================================================================

export const typingDot = (delay: number) => ({
  y: [0, -8, 0],
  transition: {
    duration: 0.6,
    repeat: Infinity,
    delay,
  },
});

// ============================================================================
// SUCCESS/ERROR FEEDBACK
// ============================================================================

export const checkmarkAppear: Variants = {
  hidden: { scale: 0, rotate: -180 },
  visible: {
    scale: 1,
    rotate: 0,
    transition: motionConfig.bouncy,
  },
};

export const errorShake = {
  x: [0, -10, 10, -10, 10, 0],
  transition: { duration: 0.4 },
};

// ============================================================================
// SEND BUTTON ANIMATION
// ============================================================================

export const sendButtonFlyAway = {
  x: [0, 30],
  opacity: [1, 0],
  rotate: [0, 25],
  transition: { duration: 0.3, ease: "easeIn" as const },
};

// ============================================================================
// PROGRESS BAR
// ============================================================================

export const progressBar = (progress: number) => ({
  width: `${progress}%`,
  transition: { duration: 0.5, ease: "easeOut" as const },
});

// ============================================================================
// 3D REVEAL (for certificates)
// ============================================================================

export const certificate3DReveal: Variants = {
  hidden: { opacity: 0, scale: 0.9, rotateX: -10 },
  visible: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    transition: {
      type: "spring",
      stiffness: 200,
      damping: 20,
    },
  },
};

// ============================================================================
// CAMERA FLASH
// ============================================================================

export const cameraFlash: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: [0, 1, 0],
    transition: { duration: 0.3 },
  },
};

// ============================================================================
// CARD FLIP
// ============================================================================

export const cardFlip: Variants = {
  hidden: { rotateY: 90, opacity: 0 },
  visible: {
    rotateY: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 200,
      damping: 20,
    },
  },
};
