import type { Config } from "tailwindcss";

/**
 * MaliHub Kenya design token system.
 *
 * Palette is grounded in a Rift Valley dusk: an ink-indigo night sky
 * (background/dark mode default) warming into copper horizon light
 * (primary accent), with a muted acacia green as the tertiary/success
 * accent. This is a working v0 palette wired end-to-end (dark + light,
 * glass surfaces, gradients) — Phase 3 (landing page) does the full
 * brainstorm/critique pass on top of this same token system so nothing
 * here gets thrown away, only refined.
 *
 * Actual values live as HSL triplets in globals.css (--background, etc.)
 * so both themes and Framer Motion color interpolation can reference them.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
        xl: "2.5rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1200px",
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          50: "hsl(var(--primary-50) / <alpha-value>)",
          100: "hsl(var(--primary-100) / <alpha-value>)",
          400: "hsl(var(--primary-400) / <alpha-value>)",
          500: "hsl(var(--primary-500) / <alpha-value>)",
          600: "hsl(var(--primary-600) / <alpha-value>)",
          700: "hsl(var(--primary-700) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        cyan: {
          DEFAULT: "hsl(var(--cyan) / <alpha-value>)",
          foreground: "hsl(var(--cyan-foreground) / <alpha-value>)",
        },
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
      },
      borderRadius: {
        xs: "0.375rem",
        sm: "0.5rem",
        DEFAULT: "0.75rem",
        md: "1rem",
        lg: "1.25rem",
        xl: "1.75rem",
        "2xl": "2.25rem",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        "dusk-gradient":
          "linear-gradient(135deg, hsl(var(--secondary)) 0%, hsl(var(--background)) 55%, hsl(var(--primary-700)) 100%)",
        "horizon-glow":
          "radial-gradient(120% 120% at 50% 0%, hsl(var(--primary) / 0.25) 0%, transparent 60%)",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.24)",
        "glass-sm": "0 4px 16px 0 rgba(0, 0, 0, 0.16)",
        "glow-primary": "0 0 40px -8px hsl(var(--primary) / 0.45)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-700px 0" },
          "100%": { backgroundPosition: "700px 0" },
        },
        // Note: "float-y", "mesh-drift", and "pulse-dot" keyframes are
        // hand-written in globals.css (not here) because they reference the
        // --float-rotate CSS custom property / cyan token directly — keeping
        // a second, config-generated definition of the same name would
        // silently fight the handwritten one in the cascade.
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-in": "fade-in 0.4s ease-out forwards",
        shimmer: "shimmer 1.8s linear infinite",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
