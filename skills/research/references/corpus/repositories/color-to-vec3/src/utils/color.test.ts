import { describe, expect, it } from "vitest";
import { colorToVec3, formatVec3, parseCssColor } from "./color";

describe("parseCssColor", () => {
  it.each([
    ["#f80", { red: 255, green: 136, blue: 0 }],
    ["#ff880080", { red: 255, green: 136, blue: 0 }],
    ["rgb(255, 128, 0)", { red: 255, green: 128, blue: 0 }],
    ["rgb(100% 50% 0% / 25%)", { red: 255, green: 128, blue: 0 }],
    ["hsl(30 100% 50%)", { red: 255, green: 128, blue: 0 }],
    ["hsl(0.5turn 100% 50%)", { red: 0, green: 255, blue: 255 }],
    ["hwb(0 20% 20%)", { red: 204, green: 51, blue: 51 }],
    ["rebeccapurple", { red: 102, green: 51, blue: 153 }],
    ["transparent", { red: 0, green: 0, blue: 0 }],
  ])("parses %s", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it("converts OKLCH into sRGB", () => {
    expect(parseCssColor("oklch(62.8% 0.2577 29.23)")).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it("accepts and ignores alpha channels", () => {
    expect(parseCssColor("rgba(10, 20, 30, 0)")).toEqual(parseCssColor("rgb(10, 20, 30)"));
    expect(parseCssColor("oklch(50% 0.1 90 / 20%)")).toEqual(parseCssColor("oklch(50% 0.1 90)"));
  });

  it.each([
    "",
    "#12",
    "rgb(256 0 0)",
    "rgb(0 0)",
    "hsl(0 50 50)",
    "oklch(50%, 0.2, 20)",
    "oklch(120% 0.2 20)",
    "var(--brand-color)",
    "linear-gradient(red, blue)",
    "not-a-color",
  ])("rejects %s", (input) => {
    expect(parseCssColor(input)).toBeNull();
  });
});

describe("formatVec3", () => {
  it("normalizes channels to the 0–1 range", () => {
    expect(formatVec3({ red: 255, green: 128, blue: 0 })).toBe("vec3(1.0, 0.502, 0.0)");
  });

  it("uses at most four decimal places", () => {
    expect(formatVec3({ red: 102, green: 51, blue: 153 })).toBe("vec3(0.4, 0.2, 0.6)");
  });
});

describe("colorToVec3", () => {
  it("returns the formatted value, RGB channels, and preview hex", () => {
    expect(colorToVec3("rebeccapurple")).toEqual({
      ok: true,
      value: "vec3(0.4, 0.2, 0.6)",
      rgb: { red: 102, green: 51, blue: 153 },
      hex: "#663399",
    });
  });

  it("returns a useful error for unsupported input", () => {
    expect(colorToVec3("currentColor")).toEqual({
      ok: false,
      error: "Enter a valid supported CSS color.",
    });
  });
});
