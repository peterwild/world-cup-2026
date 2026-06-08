// Shown wherever a bracket was built with AI Mode (the player tapped
// "Accept & edit"). Sticky — stays even if they hand-edited afterward.
export function AiAssistedBadge() {
  return (
    <span
      className="pick-badge whitespace-nowrap"
      style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
      title="Built with AI Mode"
    >
      ✨ AI Assisted
    </span>
  );
}
