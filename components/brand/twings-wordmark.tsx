/**
 * The TWINGS wordmark (2026-08-16), drawn as one monoline path set.
 *
 * `currentColor` and `stroke` rather than a PNG: §5.1's identity is a hard black↔white inversion,
 * and the mark has to flip with the section it sits in. A raster logo would need two files, a
 * `<picture>`, and would still be wrong at the moment the nav crosses a band boundary.
 *
 * Geometry is the same family as the TWIIN mark the founder built earlier — heavy round-capped
 * strokes, ball terminals, connected rhythm — so the brand change reads as a rename rather than a
 * different studio.
 */
export function TwingsWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 960 250"
      role="img"
      aria-label="TWINGS"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={46}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M40 54 H158" />
      <path d="M99 54 V196" />
      <path d="M208 54 L242 196 L276 108 L310 196 L344 54" />
      <path d="M396 54 V196" />
      <path d="M448 196 V54 L542 196 V54" />
      <path d="M692 86 A 64 71 0 1 0 692 164 L692 126 H648" />
      <path d="M914 88 A 62 37 0 1 0 838 125 A 62 37 0 1 1 762 162" />
    </svg>
  );
}
