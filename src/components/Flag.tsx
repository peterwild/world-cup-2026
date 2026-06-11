/** A rounded, framed country flag. `code` is the flag-icons suffix (e.g. "br",
 *  "gb-eng"). Decorative — the team name carries the label. `sm` for a smaller
 *  flag on dense secondary lines; `lg` for hero spots. */
export function Flag({ code, lg, sm }: { code: string; lg?: boolean; sm?: boolean }) {
  const size = lg ? " flag-lg" : sm ? " flag-sm" : "";
  return <span className={`flag fi fi-${code}${size}`} aria-hidden />;
}
