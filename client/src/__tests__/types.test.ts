import { describe, it, expect } from "vitest";
import { getLangLabel, LANG_OPTIONS } from "../types";

describe("getLangLabel", () => {
  it("returns label for known language codes", () => {
    expect(getLangLabel("en")).toBe("English");
    expect(getLangLabel("th")).toBe("Thai");
    expect(getLangLabel("my")).toBe("Myanmar");
    expect(getLangLabel("km")).toBe("Khmer (Cambodian)");
    expect(getLangLabel("lo")).toBe("Lao");
    expect(getLangLabel("vi")).toBe("Vietnamese");
    expect(getLangLabel("zh")).toBe("Chinese (Mandarin)");
  });

  it("returns the code itself for unknown codes", () => {
    expect(getLangLabel("fr")).toBe("fr");
    expect(getLangLabel("")).toBe("");
    expect(getLangLabel("xx")).toBe("xx");
  });
});

describe("LANG_OPTIONS", () => {
  it("has 7 language options", () => {
    expect(LANG_OPTIONS).toHaveLength(7);
  });

  it("each option has value and label", () => {
    for (const opt of LANG_OPTIONS) {
      expect(typeof opt.value).toBe("string");
      expect(typeof opt.label).toBe("string");
      expect(opt.value.length).toBeGreaterThan(0);
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});
