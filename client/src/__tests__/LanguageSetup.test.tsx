import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LanguageSetup from "../components/LanguageSetup";

const defaultProps = {
  doctorLang: "en" as const,
  patientLang: "my" as const,
  setDoctorLang: vi.fn(),
  setPatientLang: vi.fn(),
  onConfirm: vi.fn(),
};

describe("LanguageSetup", () => {
  it("renders language selectors with labels", () => {
    render(<LanguageSetup {...defaultProps} />);
    expect(screen.getByLabelText("Doctor speaks")).toBeInTheDocument();
    expect(screen.getByLabelText("Patient speaks")).toBeInTheDocument();
  });

  it("shows Start Consultation button enabled when languages differ", () => {
    render(<LanguageSetup {...defaultProps} />);
    const btn = screen.getByText("Start Consultation");
    expect(btn).not.toBeDisabled();
  });

  it("disables Start Consultation when languages are the same", () => {
    render(<LanguageSetup {...defaultProps} doctorLang="en" patientLang="en" />);
    const btn = screen.getByText("Start Consultation");
    expect(btn).toBeDisabled();
  });

  it("shows error when languages match", () => {
    render(<LanguageSetup {...defaultProps} doctorLang="en" patientLang="en" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Doctor and patient must speak different languages"
    );
  });

  it("calls setDoctorLang on change", () => {
    const setDoctorLang = vi.fn();
    render(<LanguageSetup {...defaultProps} setDoctorLang={setDoctorLang} />);
    fireEvent.change(screen.getByLabelText("Doctor speaks"), {
      target: { value: "th" },
    });
    expect(setDoctorLang).toHaveBeenCalledWith("th");
  });

  it("calls onConfirm when button clicked", () => {
    const onConfirm = vi.fn();
    render(<LanguageSetup {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Start Consultation"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("has accessible labels with htmlFor/id pairs", () => {
    render(<LanguageSetup {...defaultProps} />);
    const doctorSelect = document.getElementById("setup-doctor-lang");
    const patientSelect = document.getElementById("setup-patient-lang");
    expect(doctorSelect).toBeInTheDocument();
    expect(patientSelect).toBeInTheDocument();
  });

  it("hides the arrow icon from screen readers", () => {
    render(<LanguageSetup {...defaultProps} />);
    const arrow = document.querySelector(".lang-setup-arrow");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
  });
});
