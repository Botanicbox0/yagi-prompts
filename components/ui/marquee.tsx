/**
 * PLAN §5.3-5 — tools ticker, 40s linear loop, pause on hover.
 *
 * No JavaScript: one CSS animation on a track that holds the list twice, so the −50% translate
 * lands exactly on a seam. The second copy is `aria-hidden`; assistive tech reads the list once.
 * `prefers-reduced-motion` stops it at frame zero (globals.css) rather than at its end frame.
 */
export function Marquee({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;

  const run = (copy: 'a' | 'b') => (
    <ul
      key={copy}
      className="flex shrink-0 items-center"
      {...(copy === 'b' ? { 'aria-hidden': true } : {})}
    >
      {items.map((item) => (
        <li key={`${copy}-${item}`} className="flex items-center">
          <span className="font-display text-[clamp(1.75rem,3.4vw,3rem)] leading-none font-black tracking-tight uppercase whitespace-nowrap">
            {item}
          </span>
          {/* §5.1: #0000EE is the only accent — separators are one of its four jobs. */}
          <span aria-hidden className="text-accent px-[0.4em] text-[clamp(1.5rem,3vw,2.5rem)] leading-none">
            ·
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="marquee py-8">
      <h2 className="sr-only">{label}</h2>
      <div className="marquee__track">{[run('a'), run('b')]}</div>
    </div>
  );
}
