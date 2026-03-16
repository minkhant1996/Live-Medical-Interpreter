import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Disclaimer from "../components/Disclaimer";

describe("Disclaimer", () => {
  it("renders the disclaimer dialog", () => {
    render(<Disclaimer onDismiss={() => {}} />);
    expect(screen.getByText("Important Notice")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("displays warning items", () => {
    render(<Disclaimer onDismiss={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0].textContent).toContain("NOT");
    expect(items[0].textContent).toContain("medical device");
  });

  it("calls onDismiss when button is clicked", () => {
    const onDismiss = vi.fn();
    render(<Disclaimer onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("I Understand - Continue"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("has aria-modal and role dialog", () => {
    render(<Disclaimer onDismiss={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "disclaimer-title");
    expect(dialog).toHaveAttribute("aria-describedby", "disclaimer-body");
  });

  it("hides the warning icon from screen readers", () => {
    render(<Disclaimer onDismiss={() => {}} />);
    const icon = document.querySelector(".disclaimer-icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
