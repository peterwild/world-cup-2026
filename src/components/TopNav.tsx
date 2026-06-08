import Link from "next/link";

// Shared top-of-page nav for the flat pages (leaderboard, picks). One row:
// a short context label on the left that truncates first, and a fixed-order
// link cluster on the right. The current page omits its own link.
//
// Mobile note: the theme toggle is fixed top-right (40px wide, right:0.7rem →
// its left edge sits ~3.2rem from the viewport edge). These headers live inside
// a `px-4` (1rem) container, and `pr-14` (3.5rem) on top of that keeps the link
// cluster a comfortable ~1.3rem clear of the toggle even on a narrow phone. The
// right cluster is `shrink-0`; the left label is `min-w-0 truncate` so crowding
// eats the label, never the links.

type NavPage = "home" | "picks" | "leaderboard";

const LINKS: { key: NavPage; href: string; label: string }[] = [
  { key: "home", href: "/", label: "⌂ Home" },
  { key: "picks", href: "/picks", label: "My picks" },
  { key: "leaderboard", href: "/leaderboard", label: "🏆 Leaderboard" },
];

export function TopNav({
  current,
  context,
  action,
}: {
  // Omit `current` (e.g. when viewing another player's bracket) to show all
  // three links — nothing is the "current" page.
  current?: NavPage;
  context?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="pt-5 pb-3 pr-14 flex items-center justify-between gap-3">
      <span className="eyebrow truncate min-w-0 flex-1">{context}</span>
      <nav className="flex items-center gap-3 shrink-0">
        {LINKS.filter((l) => l.key !== current).map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className="eyebrow underline whitespace-nowrap"
          >
            {l.label}
          </Link>
        ))}
        {action}
      </nav>
    </header>
  );
}
