"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ThemeChoice = "system" | "light" | "dark";
type Resolved = "light" | "dark";

type Ctx = {
  theme: ThemeChoice;
  resolvedTheme: Resolved;
  setTheme: (t: ThemeChoice) => void;
};

const STORAGE_KEY = "theme";
const ThemeContext = createContext<Ctx | null>(null);

function getSystemPref(): Resolved {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStored(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function applyTheme(resolved: Resolved) {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<Resolved>("dark");
  const mqRef = useRef<MediaQueryList | null>(null);
  const onChangeRef = useRef<((e: MediaQueryListEvent) => void) | null>(null);

  const attachSystemListener = useCallback(() => {
    if (mqRef.current) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      const next: Resolved = e.matches ? "dark" : "light";
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener("change", onChange);
    mqRef.current = mq;
    onChangeRef.current = onChange;
  }, []);

  const detachSystemListener = useCallback(() => {
    if (mqRef.current && onChangeRef.current) {
      mqRef.current.removeEventListener("change", onChangeRef.current);
      mqRef.current = null;
      onChangeRef.current = null;
    }
  }, []);

  useEffect(() => {
    const stored = readStored();
    const r: Resolved = stored === "system" ? getSystemPref() : stored;
    // Bootstrap from localStorage on mount — setState here is required to sync
    // React with the no-flash script's pre-paint DOM state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(stored);
    setResolved(r);
    applyTheme(r);
    if (stored === "system") attachSystemListener();
    return detachSystemListener;
  }, [attachSystemListener, detachSystemListener]);

  const setTheme = useCallback(
    (t: ThemeChoice) => {
      window.localStorage.setItem(STORAGE_KEY, t);
      const r: Resolved = t === "system" ? getSystemPref() : t;
      setThemeState(t);
      setResolved(r);
      applyTheme(r);
      if (t === "system") attachSystemListener();
      else detachSystemListener();
    },
    [attachSystemListener, detachSystemListener],
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme: resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export const themeBootstrapScript = `
(function() {
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = (stored === "light" || stored === "dark")
      ? stored
      : (prefersDark ? "dark" : "light");
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;
