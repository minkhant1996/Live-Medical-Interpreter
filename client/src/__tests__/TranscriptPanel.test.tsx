import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TranscriptPanel from "../components/TranscriptPanel";
import type { TranscriptEntry } from "../types";

const mockTranscript: TranscriptEntry = {
  id: "1",
  role: "doctor",
  original: "Hello, how are you feeling?",
  translated: "ဟယ်လို၊ ဘယ်လိုခံစားနေပါသလဲ?",
  originalLang: "en",
  translatedLang: "my",
  timestamp: Date.now(),
};

const mockPatientTranscript: TranscriptEntry = {
  id: "2",
  role: "patient",
  original: "ခေါင်းကိုက်တယ်",
  translated: "I have a headache",
  originalLang: "my",
  translatedLang: "en",
  timestamp: Date.now(),
};

describe("TranscriptPanel", () => {
  it("shows empty state for voice mode", () => {
    render(<TranscriptPanel transcripts={[]} inputMode="voice" />);
    expect(screen.getByText("Tap a button above to start speaking.")).toBeInTheDocument();
  });

  it("shows empty state for text mode", () => {
    render(<TranscriptPanel transcripts={[]} inputMode="text" />);
    expect(screen.getByText("Type a message and press Send.")).toBeInTheDocument();
  });

  it("renders transcript entries", () => {
    render(<TranscriptPanel transcripts={[mockTranscript]} />);
    expect(screen.getByText("Hello, how are you feeling?")).toBeInTheDocument();
    expect(screen.getByText("ဟယ်လို၊ ဘယ်လိုခံစားနေပါသလဲ?")).toBeInTheDocument();
  });

  it("shows role labels", () => {
    render(<TranscriptPanel transcripts={[mockTranscript, mockPatientTranscript]} />);
    expect(screen.getByText("Doctor")).toBeInTheDocument();
    expect(screen.getByText("Patient")).toBeInTheDocument();
  });

  it("sets lang attribute on text elements", () => {
    render(<TranscriptPanel transcripts={[mockTranscript]} />);
    const original = document.querySelector(".transcript-original");
    const translated = document.querySelector(".transcript-translated");
    expect(original).toHaveAttribute("lang", "en");
    expect(translated).toHaveAttribute("lang", "my");
  });

  it("has role=log and aria-live on transcript panel", () => {
    render(<TranscriptPanel transcripts={[mockTranscript]} />);
    const panel = document.querySelector('[role="log"]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("aria-live", "polite");
  });

  it("shows language tags", () => {
    render(<TranscriptPanel transcripts={[mockTranscript]} />);
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Myanmar")).toBeInTheDocument();
  });
});
