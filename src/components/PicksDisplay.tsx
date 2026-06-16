"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Client shell for the My Picks body: a List ⇄ Bracket toggle over the same
// data. List = the round-by-round BracketView; Bracket = the orientation-aware
// BracketCanvas. The toggle is the reliable control (works under rotation lock);
// rotating a phone to landscape is a bonus that auto-reveals the bracket, with a
// one-time coachmark so the switch isn't a surprise.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { DraftBracket } from "@/lib/bracketState";
import type { Results } from "@/lib/scoring";
import type { GroupId } from "@/lib/teams";
import type { GroupStanding } from "@/lib/groupTables";
import type { AssembledBracket } from "@/lib/knockoutBracket";
import type { SpiritPulse } from "@/lib/analytics";
import { BracketView } from "@/components/BracketView";
import { BracketCanvas } from "@/components/BracketCanvas";
import { PredictedSpine } from "@/components/PredictedSpine";

type View = "list" | "bracket" | "path";
const VIEW_KEY = "wc26-picks-view";
const HINT_KEY = "wc26-bracket-hint-seen";
// A rotated phone/tablet: landscape AND a touch (coarse) pointer — so a desktop,
// which is always "landscape", never gets force-switched.
const LANDSCAPE_MOBILE = "(orientation: landscape) and (pointer: coarse)";

export function PicksDisplay(props: {
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
  spiritPulse: SpiritPulse | null;
  groupTables: Record<GroupId, GroupStanding[]>;
  bracket: AssembledBracket;
  firstKickoffISO: string | null;
  /** Inline possessive for whose picks these are — "your" (default) or "Tim's"
   *  when viewing someone else's bracket. */
  possessive?: string;
}) {
  const { draft, results, showStatus, spiritPulse, groupTables, bracket, firstKickoffISO } = props;
  const possessive = props.possessive ?? "your";

  const [mode, setMode] = useState<View>("list"); // the explicit toggle choice
  const [landscape, setLandscape] = useState(false);
  const [hint, setHint] = useState(false);

  // Sync client-only state (persisted toggle choice + live orientation) after
  // mount — localStorage and matchMedia aren't available during SSR.
  useEffect(() => {
    const restore = () => {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "bracket" || saved === "path") setMode(saved);
    };
    restore();

    const mq = window.matchMedia(LANDSCAPE_MOBILE);
    const apply = (matches: boolean) => {
      setLandscape(matches);
      if (matches && localStorage.getItem(HINT_KEY) !== "1") {
        setHint(true);
        localStorage.setItem(HINT_KEY, "1");
        setTimeout(() => setHint(false), 4500);
      }
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function choose(next: View) {
    setMode(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  // Landscape on a phone forces the bracket (that's the whole point of rotating);
  // otherwise honor the toggle.
  const view: View = landscape ? "bracket" : mode;

  return (
    <div>
      {landscape ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Bracket view · rotate back to portrait for the list
        </p>
      ) : (
        <div className="mt-3 flex justify-center">
          <div
            role="tablist"
            aria-label="Picks view"
            className="inline-flex rounded-lg border border-border p-0.5 text-sm"
          >
            <ToggleButton label="List" active={view === "list"} onClick={() => choose("list")} />
            <ToggleButton label="Bracket" active={view === "bracket"} onClick={() => choose("bracket")} />
            <ToggleButton label="Path" active={view === "path"} onClick={() => choose("path")} />
          </div>
        </div>
      )}

      {view === "bracket" ? (
        <BracketCanvas
          bracket={bracket}
          firstKickoffISO={firstKickoffISO}
          draft={draft}
          results={results}
          showStatus={showStatus}
          groupTables={groupTables}
          possessive={possessive}
        />
      ) : view === "path" ? (
        <PredictedSpine draft={draft} results={results} showStatus={showStatus} />
      ) : (
        <BracketView
          draft={draft}
          results={results}
          showStatus={showStatus}
          spiritPulse={spiritPulse}
        />
      )}

      {hint && (
        <div
          className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4 pointer-events-none"
          style={{ animation: "fadeInUp 0.35s ease-out" }}
        >
          <div
            className="rounded-full px-4 py-2 text-xs font-medium shadow-lg border"
            style={{ background: "var(--pitch)", color: "white", borderColor: "transparent" }}
          >
            🔄 Rotated to bracket view — rotate back for the list
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="px-4 py-1.5 rounded-md font-medium transition active:scale-[0.98]"
      style={active ? { background: "var(--pitch)", color: "white" } : { color: "var(--muted-foreground)" }}
    >
      {label}
    </button>
  );
}
