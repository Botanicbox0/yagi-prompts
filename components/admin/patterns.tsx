import type { ReactNode } from "react";

/**
 * The admin's shared patterns (docs/ADMIN.md §3): a page header, a status pill and the queue card.
 * The list and detail patterns join them when the render board needs them. Server components, no
 * client JavaScript — like the rest of the admin, every control is a link or a form.
 */

export function AdminPageHeader({
  eyebrow,
  title,
  count,
  countLabel,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  /** Already formatted (tabular in CSS); omitted when there is nothing to count. */
  count?: string;
  /** What the number means, for assistive technology ("3 waiting"). */
  countLabel?: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-page-head" data-admin-page-head>
      <div className="admin-page-head-text">
        {eyebrow ? <p className="admin-eyebrow">{eyebrow}</p> : null}
        <div className="admin-page-title">
          <h1>{title}</h1>
          {count !== undefined ? (
            <span className="admin-count-chip" aria-label={countLabel}>
              {count}
            </span>
          ) : null}
        </div>
        {lede ? <p className="admin-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </header>
  );
}

/** Five tones only — action, progress, done, failed, hold. No red, green or yellow (docs/ADMIN.md §3). */
export type AdminTone = "action" | "progress" | "done" | "fail" | "hold";

export function StatusPill({ tone, children }: { tone: AdminTone; children: ReactNode }) {
  return (
    <span className="admin-pill" data-tone={tone}>
      {children}
    </span>
  );
}

export interface QueueCardRow {
  key: string;
  label: string;
  href: string;
  /** `null` = the source could not be counted; never drawn as a zero. */
  count: number | null;
}

export function QueueCard({
  title,
  rows,
  locale,
  labels,
}: {
  title: string;
  rows: QueueCardRow[];
  locale: string;
  labels: { clear: string; unknown: string; unknownHint: string };
}) {
  const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
  return (
    <section className="admin-queue-card" data-admin-queue-card data-busy={total > 0 || undefined}>
      <header>
        <h3>{title}</h3>
        {total > 0 ? <span className="admin-count-chip">{total.toLocaleString(locale)}</span> : null}
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <a
              href={row.href}
              data-admin-queue={row.key}
              data-count={row.count === null ? "unknown" : row.count}
              title={row.count === null ? labels.unknownHint : undefined}
            >
              <span className="admin-queue-label">{row.label}</span>
              <span className="admin-queue-count">
                {row.count === null
                  ? labels.unknown
                  : row.count === 0
                    ? labels.clear
                    : row.count.toLocaleString(locale)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
