/**
 * The hero's in-code poster composition (PLAN §5.2 / §5.4).
 *
 * No video is generated or downloaded at build time: the real reel is rendered offline with
 * HyperFrames and dropped into `HERO_REEL` (lib/content/slots.ts). Until it lands this stands in —
 * deliberately typography-led, two inks plus the one accent, and localised, so it is a designed
 * state rather than a grey placeholder box.
 *
 * The three words are the same three the "How it reads" scene uses, so the first screen already
 * teaches the vocabulary the rest of the page is built on.
 */
export function ReelPoster({
  kicker,
  caption,
  words,
}: {
  kicker: string;
  caption: string;
  words: [string, string, string];
}) {
  const [first, second, third] = words;

  return (
    <div className="flex h-full w-full flex-col justify-between bg-black p-5 text-white sm:p-7">
      <div className="flex items-baseline justify-between gap-4 border-b border-line-dark pb-3">
        <span className="font-label text-eyebrow uppercase">{kicker}</span>
        <span className="font-mono text-[0.65rem] tracking-widest uppercase opacity-60">
          REEL / SLOT
        </span>
      </div>

      <div className="flex flex-col justify-center py-6">
        {[first, second].map((word) => (
          <span
            key={word}
            className="font-display text-[clamp(2.5rem,7.5vw,5rem)] leading-[0.86] font-black tracking-tight uppercase"
            // NOT `currentColor`: `currentColor` resolves to this element's own `color`, which is
            // `transparent`, so the stroke would be invisible too. The poster is always black, so
            // the outline ink is stated outright.
            style={{ WebkitTextStroke: '1px #ffffff', color: 'transparent' }}
          >
            {word}
          </span>
        ))}
        <span className="flex items-center gap-[0.25em] font-display text-[clamp(2.5rem,7.5vw,5rem)] leading-[0.86] font-black tracking-tight uppercase">
          {third}
          <span aria-hidden className="bg-accent inline-block h-[0.42em] w-[0.42em]" />
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line-dark pt-3 font-mono text-[0.65rem] opacity-60">
        <span className="truncate">{caption}</span>
        <span aria-hidden>00:00 / 00:12</span>
      </div>
    </div>
  );
}
