/**
 * Codename mark (PLAN §11: naming gates M5, so this is deliberately provisional).
 * Two horns and a head, drawn geometrically in `currentColor` so it inverts with the section
 * theme along with everything else. No colour of its own — §5.1 is two inks plus one accent.
 */
export function GoatMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
    >
      <path d="M3.5 2.5c0 5.2 2.2 7.6 5.5 8.6" />
      <path d="M20.5 2.5c0 5.2-2.2 7.6-5.5 8.6" />
      <path d="M8.5 11.1h7L12 21.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
