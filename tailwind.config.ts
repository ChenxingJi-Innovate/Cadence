import type { Config } from "tailwindcss"

// PROJECT-LEVEL OVERRIDE of the workspace DESIGN.md.
// Visual direction (per user, 2026-04-28): black industrial / 工业风 — dark steel
// surfaces, blueprint-cyan accent, hairline borders, square corners, mono-forward
// typography. The SQL panel reads like a CRT terminal; KPIs read like
// equipment-rack readouts.

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    fontFamily: {
      sans: [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "PingFang SC",
        "sans-serif",
      ],
      // Mono is the workhorse here — labels, KPI values, captions, code.
      mono: [
        "ui-monospace",
        "JetBrains Mono",
        "SFMono-Regular",
        "SF Mono",
        "Menlo",
        "Consolas",
        "Roboto Mono",
        "monospace",
      ],
    },
    fontSize: {
      "10": ["10px", { lineHeight: "1.4", letterSpacing: "0.04em" }],
      "11": ["11px", { lineHeight: "1.5", letterSpacing: "0.02em" }],
      "12": ["12px", { lineHeight: "1.5" }],
      "13": ["13px", { lineHeight: "1.55" }],
      "14": ["14px", { lineHeight: "1.6" }],
      "16": ["16px", { lineHeight: "1.6" }],
      "20": ["20px", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
      "24": ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
      "32": ["32px", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
      "44": ["44px", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
    },
    fontWeight: { thin: "200", light: "300", normal: "400", medium: "500", semibold: "600", bold: "700" },
    extend: {
      colors: {
        // Void: page-level blacks
        void: {
          950: "#000000",
          900: "#0A0A0A",
          800: "#111111",
          700: "#161616",
          600: "#1C1C1C",
        },
        // Steel: surfaces, borders, text
        steel: {
          900: "#0F0F0F",
          800: "#1A1A1A",
          750: "#222222",
          700: "#2A2A2A",
          650: "#333333",
          600: "#3D3D3D",
          500: "#525252",
          400: "#737373",
          300: "#A3A3A3",
          200: "#D4D4D4",
          100: "#E5E5E5",
          50:  "#F5F5F5",
        },
        // Blueprint: icy industrial cyan, the only chromatic accent
        blueprint: {
          300: "#7DEEFF",
          500: "#00E5FF",
          600: "#00B8D4",
          700: "#0097A7",
        },
        // Status (used sparingly)
        signal:  { 500: "#39FF14", 700: "#22C509" }, // success / positive deltas
        caution: { 500: "#FFB800" },                  // warnings
        alarm:   { 500: "#FF4444", 600: "#D93636" }, // errors only
      },
      borderRadius: {
        none: "0",
        xs: "1px",
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
        full: "9999px",
      },
      spacing: {
        "1": "4px",  "2": "8px",  "3": "12px", "4": "16px", "5": "20px",
        "6": "24px", "7": "28px", "8": "32px", "10": "40px", "12": "48px",
        "14": "56px","16": "64px","20": "80px","24": "96px","32": "128px",
      },
      boxShadow: {
        // Inset 1px hairline highlight — industrial CNC edge
        "inset-edge": "inset 0 0 0 1px rgba(255,255,255,0.04)",
        "glow-blueprint": "0 0 24px rgba(0,229,255,0.15)",
        "glow-alarm": "0 0 16px rgba(255,68,68,0.25)",
      },
      transitionTimingFunction: {
        machine: "cubic-bezier(0.65, 0, 0.35, 1)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        spinSlow: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        fadeUp: "fadeUp 0.2s cubic-bezier(0.65, 0, 0.35, 1)",
        scan: "scan 8s linear infinite",
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        spinSlow: "spinSlow 1.5s linear infinite",
      },
    },
  },
  plugins: [],
}
export default config
