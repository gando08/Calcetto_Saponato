/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sport: {
          bg: "#080c18",
          surface: "#0d1224",
          card: "#111827",
          "card-hover": "#162032",
          border: "rgba(255,255,255,0.07)",
          "border-accent": "rgba(0,230,118,0.35)",
          neon: "#00e676",
          "neon-dim": "#00c853",
          "neon-glow": "rgba(0,230,118,0.15)",
          blue: "#3b82f6",
          "blue-dim": "#2563eb",
          "blue-glow": "rgba(59,130,246,0.15)",
          orange: "#f97316",
          "orange-glow": "rgba(249,115,22,0.15)",
          gold: "#f59e0b",
          silver: "#94a3b8",
          bronze: "#b45309",
          muted: "rgba(255,255,255,0.45)",
          subtle: "rgba(255,255,255,0.07)",
        }
      },
      animation: {
        "pulse-neon": "pulseNeon 2.5s ease-in-out infinite",
        "slide-in": "slideIn 0.25s ease-out",
        "fade-in": "fadeIn 0.35s ease-out",
        "score-pop": "scorePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        "live-dot": "liveDot 1.4s ease-in-out infinite",
        "shimmer": "shimmer 2.2s linear infinite",
        "progress": "progressFill 1s ease-out",
      },
      keyframes: {
        pulseNeon: {
          "0%, 100%": { boxShadow: "0 0 8px rgba(0,230,118,0.3), 0 0 24px rgba(0,230,118,0.1)" },
          "50%": { boxShadow: "0 0 16px rgba(0,230,118,0.6), 0 0 40px rgba(0,230,118,0.2)" },
        },
        slideIn: {
          "0%": { transform: "translateX(-12px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scorePop: {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "60%": { transform: "scale(1.1)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        liveDot: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.7)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        progressFill: {
          "0%": { width: "0%" },
        },
      },
      boxShadow: {
        "neon-sm": "0 0 8px rgba(0,230,118,0.35)",
        "neon-md": "0 0 16px rgba(0,230,118,0.45)",
        "neon-lg": "0 0 32px rgba(0,230,118,0.55), 0 0 64px rgba(0,230,118,0.15)",
        "blue-sm": "0 0 8px rgba(59,130,246,0.35)",
        "blue-md": "0 0 16px rgba(59,130,246,0.45)",
        "orange-sm": "0 0 8px rgba(249,115,22,0.35)",
        "card": "0 4px 24px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)",
        "card-hover": "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
        "inset-neon": "inset 0 1px 0 rgba(0,230,118,0.2)",
      },
      backgroundImage: {
        "neon-gradient": "linear-gradient(135deg, #00e676 0%, #00c853 100%)",
        "blue-gradient": "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
        "gold-gradient": "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
        "silver-gradient": "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
        "bronze-gradient": "linear-gradient(135deg, #b45309 0%, #92400e 100%)",
        "card-glass": "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        "shimmer-glass": "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)",
      },
    }
  },
  plugins: []
};
