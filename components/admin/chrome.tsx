import type { ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { runAdminOperation } from '@/app/(admin)/admin/actions';
import { BACK_FIELD, OP_FIELD } from '@/lib/admin/form';
import type { AdminOperationName } from '@/lib/admin/operations';

/**
 * The admin surface's furniture (§4: "dense utilitarian layout, left nav + table/editor; no ad
 * rail, no scroll theatrics").
 *
 * Everything here is a SERVER component and every control is a plain `<form>` posting to the one
 * guarded server action. No client JS at all: an editor that keeps working with scripts disabled is
 * a smaller attack surface, a smaller bundle, and — for a tool used by two people — simply less to
 * go wrong. The trade is no optimistic UI, which a CMS does not need.
 */

export type AdminDict = Dictionary['admin'];

export function OpForm({
  op,
  back,
  children,
  className,
}: {
  op: AdminOperationName;
  /** Where the action returns to; the dispatcher refuses anything outside `/admin`. */
  back: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form action={runAdminOperation} className={className}>
      <input type="hidden" name={OP_FIELD} value={op} />
      <input type="hidden" name={BACK_FIELD} value={back} />
      {children}
    </form>
  );
}

export const BUTTON =
  'border border-hairline px-3 py-1.5 font-label text-eyebrow uppercase hover:border-accent hover:text-accent';
export const BUTTON_PRIMARY =
  'border border-accent bg-accent px-4 py-2 font-label text-eyebrow uppercase text-white';
export const INPUT =
  'w-full border border-hairline bg-transparent px-2.5 py-1.5 font-mono text-code outline-none focus:border-accent';
export const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block font-mono text-[0.72rem] opacity-50">{hint}</span>}
    </label>
  );
}

/** §3.8 "dual-locale side-by-side fields" — the shape every localized field takes in this editor. */
export function LocalePair({
  label,
  name,
  value,
  hint,
  multiline,
  rows = 3,
}: {
  label: string;
  name: string;
  value: { en: string; ko: string } | null;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const cell = (locale: 'en' | 'ko', tag: string) => {
    const field = `${name}${locale === 'en' ? 'En' : 'Ko'}`;
    const current = value?.[locale] ?? '';
    return (
      <label className="block">
        <span className="font-label text-[0.68rem] uppercase tracking-[0.12em] opacity-45">
          {tag}
        </span>
        {multiline ? (
          <textarea name={field} rows={rows} defaultValue={current} className={`${INPUT} mt-1`} />
        ) : (
          <input type="text" name={field} defaultValue={current} className={`${INPUT} mt-1`} />
        )}
      </label>
    );
  };

  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
        {cell('en', 'EN')}
        {cell('ko', 'KO')}
      </div>
      {hint && <p className="mt-1 font-mono text-[0.72rem] opacity-50">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 border border-hairline">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <h2 className="font-label text-eyebrow uppercase">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// outcome banner
// ---------------------------------------------------------------------------

const SUCCESS_KEYS = {
  created: 'okCreated',
  saved: 'okSaved',
  deleted: 'okDeleted',
  moved: 'okMoved',
  prepared: 'okPrepared',
  published: 'okPublished',
  cachesRefreshed: 'okCachesRefreshed',
  draftOpened: 'okDraftOpened',
  archived: 'okArchived',
  unarchived: 'okUnarchived',
  approved: 'okApproved',
  rejected: 'okRejected',
  unpublished: 'okUnpublished',
} as const;

const ERROR_KEYS = {
  forbidden: 'errForbidden',
  unknownOperation: 'errUnknownOperation',
  invalid: 'errInvalid',
  notFound: 'errNotFound',
  duplicateSlug: 'errDuplicateSlug',
  notDraft: 'errNotDraft',
  privileged: 'errPrivileged',
  notPrepared: 'errNotPrepared',
  manifestIncomplete: 'errManifestIncomplete',
  manifestStale: 'errManifestStale',
  changeNoteRequired: 'errChangeNoteRequired',
  localeIncomplete: 'errLocaleIncomplete',
  assetIncomplete: 'errAssetIncomplete',
  storage: 'errStorage',
  upload: 'errUpload',
  notPublishable: 'errNotPublishable',
  deadlineNotPassed: 'errDeadlineNotPassed',
  duplicatePlacement: 'errDuplicatePlacement',
  unknown: 'errUnknown',
} as const;

/**
 * Codes in, prose out. The database's own message rides along as `detail` — this is a staff tool,
 * and a trigger saying "publish manifest is stale for revision X" is the most useful sentence
 * anyone could put on the screen.
 */
export function OutcomeBanner({
  dict,
  ok,
  err,
  detail,
}: {
  dict: AdminDict;
  ok?: string;
  err?: string;
  detail?: string;
}) {
  const successKey = ok ? SUCCESS_KEYS[ok as keyof typeof SUCCESS_KEYS] : undefined;
  const errorKey = err ? ERROR_KEYS[err as keyof typeof ERROR_KEYS] : undefined;
  if (!successKey && !errorKey) return null;

  const failed = Boolean(errorKey);
  const message = failed
    ? dict[errorKey as keyof AdminDict]
    : dict[successKey as keyof AdminDict];

  return (
    <div
      role="status"
      data-outcome={failed ? 'error' : 'ok'}
      className={`mt-6 border px-4 py-3 ${failed ? 'border-accent' : 'border-hairline'}`}
    >
      <p className="font-label text-eyebrow uppercase">{String(message)}</p>
      {detail && (
        <p className="mt-1.5 font-mono text-[0.75rem] break-words opacity-60">
          {dict.detailLabel}: {detail}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

export function AdminShell({
  dict,
  locale,
  active,
  children,
}: {
  dict: AdminDict;
  locale: string;
  active: 'playbooks' | 'policy' | 'prompts' | 'contests';
  children: ReactNode;
}) {
  const navClass = (key: 'playbooks' | 'policy' | 'prompts' | 'contests') =>
    `font-label text-eyebrow uppercase ${active === key ? 'text-accent' : 'opacity-60'}`;

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-4 px-gutter py-4">
          <div className="flex items-center gap-6">
            <a href="/admin" className="font-display text-[1.05rem] leading-none font-black uppercase">
              {dict.brand}
            </a>
            <nav className="flex items-center gap-5">
              {/* §13 put prompts first: it is the v1.5 surface, and the moderation queue is the
                  screen that has work waiting in it on any given day. */}
              <a href="/admin/prompts" className={navClass('prompts')}>
                {dict.navPrompts}
              </a>
              {/* §14 — the contests queue is the second screen with work waiting in it. */}
              <a href="/admin/contests" className={navClass('contests')}>
                {dict.navContests}
              </a>
              <a href="/admin" className={navClass('playbooks')}>
                {dict.navPlaybooks}
              </a>
              <a href="/admin/policy" className={navClass('policy')}>
                {dict.navPolicy}
              </a>
              <a href={`/${locale}`} className="font-label text-eyebrow uppercase opacity-60">
                {dict.navSite}
              </a>
            </nav>
          </div>
          <OpForm op="caches.refresh" back="/admin" className="flex items-center gap-3">
            <button type="submit" className={BUTTON}>
              {dict.refreshCaches}
            </button>
          </OpForm>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-shell px-gutter py-10">
        {children}
      </main>
    </div>
  );
}
