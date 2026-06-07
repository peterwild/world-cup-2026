/** A rounded, framed country flag. `code` is the flag-icons suffix (e.g. "br",
 *  "gb-eng"). Decorative — the team name carries the label. */
export function Flag({ code, lg }: { code: string; lg?: boolean }) {
  return <span className={`flag fi fi-${code}${lg ? " flag-lg" : ""}`} aria-hidden />;
}
