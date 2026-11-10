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

export function YagiLogo({
  size = 16,
  className,
}: {
  size?: 16 | 18 | 22;
  className?: string;
}) {
  const markHeight = size === 16 ? 'h-[18px]' : size === 22 ? 'h-[24px]' : 'h-[20px]';
  return (
    <span
      data-yagi-logo
      className={['inline-flex items-center gap-2', className].filter(Boolean).join(' ')}
    >
      <YagiMark className={`${markHeight} ys-brand-mark`} />
      <strong className="text-[12px] font-bold tracking-[0.04em] text-[var(--ys-ink)]">YAGI</strong>
    </span>
  );
}

/**
 * Legacy YAGI STUDIO lockup retained for unit-test compatibility;
 * the live `brand.twings.app` sidebar uses `TwingsStudioLockup` + `Powered by YAGI`.
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
