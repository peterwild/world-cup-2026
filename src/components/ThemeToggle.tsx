"use client";

import { useTheme } from "./ThemeProvider";

// Fixed top-right toggle, present on every screen. Icon shows the CURRENT theme
// (moon at night / sun by day — the Vercel/Linear convention); the aria-label
// carries the action. Safe-area aware so it clears the iOS notch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed z-50 flex items-center justify-center rounded-full border border-border card-surface active:scale-95 transition"
      style={{
        top: "calc(env(safe-area-inset-top) + 0.6rem)",
        right: "0.7rem",
        width: 40,
        height: 40,
      }}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
