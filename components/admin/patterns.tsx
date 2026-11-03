import type { ReactNode } from "react";

/**
 * The admin's shared patterns (docs/ADMIN.md §3): the list (filter pills, table, pager), the detail
 * (header with status, facts, timeline), the queue card, and — in chrome.tsx — the confirm check.
 * Server components, no client JavaScript: every control is a link or a form.
 */

export function AdminPageHeader({
  back,
  eyebrow,
  title,
  status,
  count,
  countLabel,
  lede,
  actions,
}: {
  /** The list this page belongs to, as "← name". */
  back?: { href: string; label: string };
  eyebrow?: string;
  title: string;
  /** A `StatusPill` beside the title, for a detail page. */
  status?: ReactNode;
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
        {back ? (
          <a href={back.href} className="admin-back">
            ← {back.label}
          </a>
        ) : null}
        {eyebrow ? <p className="admin-eyebrow">{eyebrow}</p> : null}
        <div className="admin-page-title">
          <h1>{title}</h1>
          {status}
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

// ---------------------------------------------------------------------------
// list: filter pills, table, pager
// ---------------------------------------------------------------------------

export interface FilterPill {
  key: string;
  label: string;
  href: string;
  /** Already formatted. */
  count?: string;
  current: boolean;
}

/** One row of pill links. `aria-current="true"` — the page itself is current in the menu. */
export function FilterPills({ label, pills }: { label: string; pills: FilterPill[] }) {
  return (
    <nav className="admin-filters" aria-label={label}>
      <ul>
        {pills.map((pill) => (
          <li key={pill.key}>
            <a href={pill.href} data-filter={pill.key} aria-current={pill.current ? "true" : undefined}>
              {pill.label}
              {pill.count !== undefined ? <span className="admin-filter-count">{pill.count}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface AdminColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface AdminTableRow {
  key: string;
  cells: Record<string, ReactNode>;
  /** `data-*` markers for the row (tests and the sweep read these). */
  data?: Record<`data-${string}`, string>;
}

/**
 * A dense table with hairlines. On a phone each row becomes a short card: every cell carries its
 * column name in `data-label`, which the CSS prints in front of the value.
 */
export function AdminTable({
  caption,
  columns,
  rows,
  empty,
}: {
  caption: string;
  columns: AdminColumn[];
  rows: AdminTableRow[];
  empty: ReactNode;
}) {
  if (rows.length === 0) return <p className="admin-empty">{empty}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption className="admin-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-numeric={column.numeric || undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} {...row.data}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label} data-numeric={column.numeric || undefined}>
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  label,
  summary,
  prev,
  next,
  prevLabel,
  nextLabel,
}: {
  label: string;
  summary: string;
  prev: string | null;
  next: string | null;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <nav className="admin-pager" aria-label={label}>
      <p>{summary}</p>
      <div>
        {prev ? (
          <a href={prev} rel="prev" className="admin-btn">
            {prevLabel}
          </a>
        ) : (
          <span className="admin-btn" aria-disabled="true">
            {prevLabel}
          </span>
        )}
        {next ? (
          <a href={next} rel="next" className="admin-btn">
            {nextLabel}
          </a>
        ) : (
          <span className="admin-btn" aria-disabled="true">
            {nextLabel}
          </span>
        )}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// detail: facts and timeline
// ---------------------------------------------------------------------------

export function FactList({ items }: { items: Array<{ label: string; value: ReactNode; wide?: boolean }> }) {
  return (
    <dl className="admin-facts">
      {items.map((item) => (
        <div key={item.label} data-wide={item.wide || undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TimelineItem {
  key: string;
  label: string;
  /** Formatted time, or null when the step has not happened. */
  at: string | null;
  detail?: string;
}

export function Timeline({ label, items, pending }: { label: string; items: TimelineItem[]; pending: string }) {
  return (
    <ol className="admin-timeline" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} data-done={item.at ? "true" : undefined}>
          <span className="admin-timeline-dot" aria-hidden="true" />
          <div>
            <p className="admin-timeline-label">{item.label}</p>
            <p className="admin-timeline-at">
              {item.at ?? pending}
              {item.detail ? ` · ${item.detail}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
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
