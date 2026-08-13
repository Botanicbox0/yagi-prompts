/**
 * PLAN §3.6 — "v1 renders a single house placeholder: bordered card, `YOUR AD HERE` in Big
 * Shoulders 900, blue `advertise@yagiworkshop.xyz` link. 300×max-600px."
 *
 * `<AdSlots slot="...">` reading a DB-backed table is deferred until a real advertiser exists
 * (`AD_SLOTS_DB_BACKED` in lib/flags.ts); this is the static config module's whole output.
 */

export interface AdLabels {
  label: string;
  placeholder: string;
  pitch: string;
  contact: string;
}

/**
 * Founder pass (2026-08-13): the rail unit is a true skyscraper — the IAB half-page 300×600, not a
 * content-sized box. The placeholder line runs VERTICALLY (`writing-mode`), which is what makes
 * 600px of height read as a designed surface instead of a short card with air under it.
 */
export function AdCard({ labels, className }: { labels: AdLabels; className?: string }) {
  return (
    <aside
      aria-label={labels.label}
      className={[
        'flex h-[600px] w-full flex-col border border-hairline bg-surface p-6 text-on-surface',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="font-label text-eyebrow uppercase opacity-60">{labels.label}</p>

      <div className="flex min-h-0 flex-1 items-center justify-center py-6">
        <p className="font-display text-[3.25rem] leading-none font-black tracking-tight uppercase [writing-mode:vertical-rl]">
          {labels.placeholder}
        </p>
      </div>

      <p className="text-[0.9375rem] leading-snug opacity-70">{labels.pitch}</p>

      <a
        href={`mailto:${labels.contact}`}
        className="text-accent mt-4 inline-block font-mono text-code underline-offset-4 hover:underline"
      >
        {labels.contact}
      </a>
    </aside>
  );
}

/**
 * §3.6 "Below 1440: one inline banner slot (landing: between sections)". Rendered in the HTML at
 * every width and hidden by CSS at the rail tier, so "never more than one ad per viewport" holds
 * without JavaScript deciding it.
 */
export function AdBanner({ labels }: { labels: AdLabels }) {
  return (
    <aside
      aria-label={labels.label}
      className="flex flex-col gap-4 border border-hairline p-6 sm:flex-row sm:items-center sm:justify-between rail:hidden"
    >
      <div>
        <p className="font-label text-eyebrow uppercase opacity-60">{labels.label}</p>
        <p className="mt-3 font-display text-[2rem] leading-[0.9] font-black tracking-tight uppercase">
          {labels.placeholder}
        </p>
      </div>
      <div className="sm:text-right">
        <p className="text-[0.9375rem] leading-snug opacity-70">{labels.pitch}</p>
        <a
          href={`mailto:${labels.contact}`}
          className="text-accent mt-2 inline-block font-mono text-code underline-offset-4 hover:underline"
        >
          {labels.contact}
        </a>
      </div>
    </aside>
  );
}
