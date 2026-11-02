import { TwingsWordmark } from './twings-wordmark';

/**
 * The TWINGS mark — the rabbit (founder, 2026-09-11: `YAGI_TW_RABBIT_WHITE_ON_BLACK_2048.png`).
 *
 * Rendered as a CSS mask filled with `currentColor`, not as an `<img>`: §5.1's identity is a hard
 * black↔white inversion and the mark has to flip with the section it sits in, exactly like the
 * wordmark beside it. The mask is the rabbit's alpha (public/brand/twings-mark-mask.png); the
 * solid black and white PNGs next to it exist for places CSS cannot reach (mail, OG, decks).
 *
 * Aspect 1.408 : 1 — give it a height and let the width follow (`aspect-[1.408]`).
 */
const MASK = 'url(/brand/twings-mark-mask.png)';

export function TwingsMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-twings-mark
      className={['inline-block aspect-[1.408] shrink-0 bg-current', className].filter(Boolean).join(' ')}
      style={{
        WebkitMaskImage: MASK,
        maskImage: MASK,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}

/**
 * The lockup: rabbit, then the word. `size` is the wordmark height; the mark stands a little taller
 * because its ears carry the visual weight the letters' cap height does not.
 */
export function TwingsLogo({ size = 18, className }: { size?: 16 | 18 | 22; className?: string }) {
  const word = size === 16 ? 'h-[16px]' : size === 22 ? 'h-[22px]' : 'h-[18px]';
  const mark = size === 16 ? 'h-[20px]' : size === 22 ? 'h-[28px]' : 'h-[22px]';
  return (
    <span data-twings-logo className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <TwingsMark className={mark} />
      <TwingsWordmark className={`${word} w-auto`} />
    </span>
  );
}
