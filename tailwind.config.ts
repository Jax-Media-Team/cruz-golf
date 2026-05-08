import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Augusta-leaning emerald
        brand: {
          50: "#eef7f1",
          100: "#d6ecdf",
          200: "#aed8bf",
          300: "#7cbe9a",
          400: "#4ea27a",
          500: "#2c8762",
          600: "#1d6b4d",
          700: "#155340",
          800: "#0d3b2a",
          900: "#082a1d",
          950: "#04150f"
        },
        // Warm cream / sand for light surfaces
        cream: {
          50: "#fbf8f1",
          100: "#f5efe0",
          200: "#ebe1c8",
          300: "#dccfa7",
          400: "#c9a14a",
          500: "#a17e2f"
        },
        // Brand gold — Cruz mark
        gold: {
          300: "#E8C25E",
          400: "#DDB13F",
          500: "#D9AD2C",
          600: "#B8901F",
          700: "#8F6F18"
        },
        ink: {
          50: "#f6f7f8",
          100: "#e9ebee",
          200: "#cdd2d9",
          300: "#a3acb8",
          500: "#6a7280",
          700: "#3a414b",
          900: "#15181d",
          950: "#0a0b0e"
        }
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif"
        ],
        serif: [
          "var(--font-instrument)",
          "ui-serif",
          "Georgia",
          "serif"
        ]
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem", "3xl": "1.5rem" },
      boxShadow: {
        soft: "0 1px 2px rgba(10,11,14,0.04), 0 8px 24px -12px rgba(10,11,14,0.12)",
        glow: "0 0 0 1px rgba(245,239,224,0.06), 0 20px 60px -20px rgba(13,59,42,0.6)"
      }
    }
  },
  plugins: []
};

export default config;
