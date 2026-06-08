import type { Config } from "tailwindcss";

/**
 * LIGHT THEME ONLY. We set darkMode to "class" and never add the `dark` class,
 * so OS-level dark mode can never flip the UI. There are no `dark:` variants in
 * this project. Design tokens below mirror the spec exactly.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F7F8FA",
        surface: "#FFFFFF",
        border: "#E5E7EB",
        foreground: "#111827",
        muted: "#6B7280",
        accent: "#4F46E5",
        fidelity: {
          high: "#10B981",
          mid: "#F59E0B",
          low: "#EF4444",
        },
        node: {
          endpoint: "#4F46E5",
          repeater: "#0EA5E9",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17, 24, 39, 0.04), 0 4px 16px rgba(17, 24, 39, 0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
    },
  },
  plugins: [],
};

export default config;
