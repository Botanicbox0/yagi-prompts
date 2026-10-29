/**
 * The YAGI Studio mark — the organic YW ligature (`YAGI_YW_02_BLACK_BG_2048.png` / `YAGI_YW_02_WHITE_BG_2048.png`).
 *
 * Rendered as a CSS alpha mask filled with `currentColor` (`public/brand/yagi-mark-mask.png`, aspect 0.844 : 1)
 * so it adapts cleanly across dark cinema surfaces (`#F0F0F0` on `#0A0A0A`) and print/PDF sheets (`#151515` on `#FFFFFF`).
 */
const YAGI_MASK = 'url(/brand/yagi-mark-mask.png)';

export function YagiMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-yagi-mark
      className={['inline-block aspect-[0.844] shrink-0 bg-current', className].filter(Boolean).join(' ')}
      style={{
        WebkitMaskImage: YAGI_MASK,
        maskImage: YAGI_MASK,
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
 * YAGI STUDIO header lockup for `brand.twings.app`:
 * Organic YW mark + "YAGI" + "STUDIO" badge. No red indicator: TWINGS screens never use the YAGI v1.2
 * red (docs/design/TASTE.md).
 */
export function YagiStudioLockup({
  size = 22,
  subtitle,
  className,
}: {
  size?: 18 | 22 | 26;
  subtitle?: string;
  className?: string;
}) {
  const markHeight = size === 18 ? 'h-[22px]' : size === 26 ? 'h-[30px]' : 'h-[26px]';
  return (
    <span
      data-yagi-studio-lockup
      className={['ys-brand-lockup', className].filter(Boolean).join(' ')}
    >
      <span className="ys-brand-lockup-row">
        <YagiMark className={`${markHeight} ys-brand-mark`} />
        <span className="ys-brand-wordmark">
          <strong>YAGI</strong>
          <span className="ys-brand-studio-tag">STUDIO</span>
        </span>
      </span>
      {subtitle && <span className="ys-brand-subtitle">{subtitle}</span>}
    </span>
  );
}
