import {
  ADMIN_NAV_GROUPS,
  ADMIN_NAV_PATHS,
  adminNavGroupOf,
  type AdminShellKey,
} from "@/lib/admin/workflow";
import { WorkspaceLanguage } from "@/components/brand-workspace/language";
import { PublicLink } from "@/components/admin/public-link";
import { NavIcon } from "@/components/admin/icons";
import type { ReactNode } from "react";
import { TwingsLogo } from "@/components/brand/twings-mark";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";
import { ADMIN_ACTION_PATH, BACK_FIELD, OP_FIELD } from "@/lib/admin/form";
import type { AdminOperationName } from "@/lib/admin/operations";

/**
 * The admin surface's furniture (§4: "dense utilitarian layout, left nav + table/editor; no ad
 * rail, no scroll theatrics").
 *
 * Everything here is a SERVER component and every control is a plain `<form>` posting to the one
 * guarded door (`POST /admin/do`). No client JS at all: an editor that keeps working with scripts
 * disabled is a smaller attack surface, a smaller bundle, and — for a tool used by two people —
 * simply less to go wrong. The trade is no optimistic UI, which a CMS does not need.
 */

export type AdminDict = Dictionary["admin"];

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
  /**
   * A plain multipart POST to a STABLE URL, not a server action (2026-08-14). An action id is
   * build-scoped, so a long-lived admin tab kept posting one the current deployment no longer
   * knew — which Next answers with a bare re-render, i.e. "the button does nothing and my edit is
   * gone". See app/(admin)/admin/do/route.ts. It also happens to be the most literal reading of
   * §3.8's JS-free admin: this form works with scripting disabled entirely.
   */
  return (
    <form
      method="post"
      action={ADMIN_ACTION_PATH}
      encType="multipart/form-data"
      className={className}
    >
      <input type="hidden" name={OP_FIELD} value={op} />
      <input type="hidden" name={BACK_FIELD} value={back} />
      {children}
    </form>
  );
}

/**
 * P2-7: the JS-free confirmation for an irreversible or outbound action. A required checkbox inside
 * the form, so the browser refuses the first press until the operator has read the sentence.
 */
export function ConfirmCheck({ label }: { label: string }) {
  return (
    <label
      className="bw-check flex items-start gap-2 font-mono text-[0.75rem]"
      data-confirm-check
    >
      <input type="checkbox" name="_confirm" value="1" required />
      <span>{label}</span>
    </label>
  );
}

export const BUTTON =
  "admin-btn border border-hairline px-3.5 py-1.5 text-[13px] font-medium hover:border-accent hover:text-accent";
export const BUTTON_PRIMARY =
  "admin-btn admin-btn-primary border border-accent bg-accent px-4 py-2 text-[13px] font-medium text-white";
export const INPUT =
  "admin-input w-full border border-hairline bg-transparent px-3 py-2 text-[13.5px] outline-none focus:border-accent";
export const LABEL = "admin-field-label block text-[12px] font-semibold";

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
    <label className="admin-field block">
      <span className={LABEL}>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && (
        <span className="admin-field-hint mt-1 block text-[12px] opacity-65">
          {hint}
        </span>
      )}
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
  const cell = (locale: "en" | "ko", tag: string) => {
    const field = `${name}${locale === "en" ? "En" : "Ko"}`;
    const current = value?.[locale] ?? "";
    return (
      <label className="block">
        <span className="admin-locale-tag font-label text-[0.68rem] uppercase tracking-[0.08em]">
          {tag}
        </span>
        {multiline ? (
          <textarea
            name={field}
            rows={rows}
            defaultValue={current}
            className={`${INPUT} mt-1.5`}
          />
        ) : (
          <input
            type="text"
            name={field}
            defaultValue={current}
            className={`${INPUT} mt-1.5`}
          />
        )}
      </label>
    );
  };

  return (
    <div className="admin-locale-pair">
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
        {cell("en", "EN")}
        {cell("ko", "KO")}
      </div>
      {hint && (
        <p className="admin-field-hint mt-1 text-[12px] opacity-65">{hint}</p>
      )}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="admin-panel mt-7 border border-hairline">
      <header className="admin-panel-head flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h2 className="admin-panel-title text-[14px] font-semibold">{title}</h2>
        {action}
      </header>
      <div className="admin-panel-body p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// outcome banner
// ---------------------------------------------------------------------------

const SUCCESS_KEYS = {
  created: "okCreated",
  saved: "okSaved",
  deleted: "okDeleted",
  moved: "okMoved",
  prepared: "okPrepared",
  published: "okPublished",
  cachesRefreshed: "okCachesRefreshed",
  draftOpened: "okDraftOpened",
  archived: "okArchived",
  unarchived: "okUnarchived",
  approved: "okApproved",
  rejected: "okRejected",
  unpublished: "okUnpublished",
  selected: "okSelected",
  declined: "okDeclined",
  verified: "okVerified",
  paid: "okPaid",
  announced: "okAnnounced",
  paymentRechecked: "okPaymentRechecked",
  paymentUnchanged: "okPaymentUnchanged",
} as const;

const ERROR_KEYS = {
  forbidden: "errForbidden",
  unknownOperation: "errUnknownOperation",
  invalid: "errInvalid",
  notFound: "errNotFound",
  duplicateSlug: "errDuplicateSlug",
  notDraft: "errNotDraft",
  privileged: "errPrivileged",
  notPrepared: "errNotPrepared",
  manifestIncomplete: "errManifestIncomplete",
  manifestStale: "errManifestStale",
  changeNoteRequired: "errChangeNoteRequired",
  localeIncomplete: "errLocaleIncomplete",
  assetIncomplete: "errAssetIncomplete",
  storage: "errStorage",
  upload: "errUpload",
  notPublishable: "errNotPublishable",
  deadlineNotPassed: "errDeadlineNotPassed",
  duplicatePlacement: "errDuplicatePlacement",
  staleReview: "errStaleReview",
  placementsLocked: "errPlacementsLocked",
  badTransition: "errBadTransition",
  slotsFull: "errSlotsFull",
  notReleasable: "errNotReleasable",
  metricsRequired: "errMetricsRequired",
  brandConflict: "errBrandConflict",
  collaborationRateLimited: "errCollaborationRateLimited",
  studioRateLimited: "errStudioRateLimited",
  brandNotActive: "errBrandNotActive",
  brandConsentRequired: "errBrandConsentRequired",
  brandNotShared: "errBrandNotShared",
  paymentWrongEnvironment: "errPaymentWrongEnvironment",
  paymentCooldown: "errPaymentCooldown",
  paymentUnavailable: "errPaymentUnavailable",
  unknown: "errUnknown",
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
  const successKey = ok
    ? SUCCESS_KEYS[ok as keyof typeof SUCCESS_KEYS]
    : undefined;
  const errorKey = err ? ERROR_KEYS[err as keyof typeof ERROR_KEYS] : undefined;
  if (!successKey && !errorKey) return null;

  const failed = Boolean(errorKey);
  const message = failed
    ? dict[errorKey as keyof AdminDict]
    : dict[successKey as keyof AdminDict];

  const showDetail = Boolean(
    detail && (failed || ok === "paymentRechecked" || ok === "paymentUnchanged"),
  );

  return (
    <div
      role="status"
      data-outcome={failed ? "error" : "ok"}
      className={`admin-outcome mt-5 rounded-[14px] border px-4 py-3 text-[13.5px] ${failed ? "border-ink" : "border-hairline"}`}
    >
      <p className="admin-outcome-title font-medium">{String(message)}</p>
      {/* The database's sentence matters when something failed; a slug under "Created." is noise (2026-09-11). */}
      {showDetail && (
        <p className="admin-outcome-detail mt-1.5 font-mono text-[12px] break-words opacity-75">
          {dict.detailLabel}: {detail}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

export function AdminBrand({ dict }: { dict: AdminDict }) {
  return (
    <a href="/admin" className="workspace-brand" aria-label={dict.brand}>
      <TwingsLogo size={18} />
      <span className="workspace-brand-byline">{dict.byline}</span>
    </a>
  );
}

/**
 * P1-6: sign-out on the admin host. A plain same-origin POST (no JS), like the brand workspace's;
 * `/auth/signout` sends admin.twings.app back to the admin sign-in chooser.
 */
export function AdminSignOut({
  dict,
  className,
}: {
  dict: AdminDict;
  className?: string;
}) {
  return (
    <form method="post" action="/auth/signout" data-admin-signout>
      <button type="submit" className={className}>
        {dict.signOut}
      </button>
    </form>
  );
}

const LEGACY_PATHS = { playbooks: "/admin/playbooks", policy: "/admin/policy" } as const;

/**
 * Every admin page sits in this frame (docs/ADMIN.md §5): a quiet grouped rail on the canvas, one
 * white work surface with the location and the language switch, then the page. On a phone the rail
 * folds behind a "Menu" control — a checkbox and its label, so it opens with scripts disabled — and
 * the page starts on the first screen instead of under twelve menu entries (audit §3.1).
 *
 * `active` may be a legacy key (the playbook editor and its policy): those pages keep their routes
 * but no menu entry, so nothing in the rail is marked current for them.
 */
export function AdminShell({
  dict,
  locale,
  active,
  children,
}: {
  dict: AdminDict;
  locale: string;
  active: AdminShellKey;
  children: ReactNode;
}) {
  const dictionary = getDictionary(isLocale(locale) ? locale : "en");
  const workflow = dictionary.adminWorkflow;
  const c = dictionary.adminConsole;
  const group = adminNavGroupOf(active);
  // "Refresh caches" returns to where it was pressed.
  const here =
    active === "playbooks" || active === "policy" ? LEGACY_PATHS[active] : ADMIN_NAV_PATHS[active];
  return (
    <div
      className="admin-console"
      data-admin-active={active}
      data-section
      data-theme="light"
    >
      <a href="#main" className="admin-skip-link">
        {workflow.skip}
      </a>
      <aside className="admin-rail">
        <div className="admin-rail-head">
          <AdminBrand dict={dict} />
          <input
            type="checkbox"
            id="admin-menu-toggle"
            className="admin-menu-toggle"
            aria-controls="admin-navigation"
          />
          <label htmlFor="admin-menu-toggle" className="admin-menu-button">
            <span>{c.menu}</span>
            <span className="admin-menu-here">{c.nav[active]}</span>
          </label>
          <nav
            id="admin-navigation"
            data-admin-navigation
            aria-label={workflow.navigation}
            className="admin-nav"
          >
            {ADMIN_NAV_GROUPS.map((navGroup) => (
              <section
                key={navGroup.key}
                className="admin-nav-group"
                aria-labelledby={`admin-nav-${navGroup.key}`}
              >
                <h2 id={`admin-nav-${navGroup.key}`}>{c.groups[navGroup.key]}</h2>
                <ul>
                  {navGroup.items.map((key) => (
                    <li key={key}>
                      <a
                        href={ADMIN_NAV_PATHS[key]}
                        data-admin-nav={key}
                        aria-current={active === key ? "page" : undefined}
                      >
                        <NavIcon name={key} />
                        <span>{c.nav[key]}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="admin-rail-foot">
              <PublicLink href={`/${locale}`}>{dict.navSite} ↗</PublicLink>
              <OpForm op="caches.refresh" back={here}>
                <button type="submit">{dict.refreshCaches}</button>
              </OpForm>
              <AdminSignOut dict={dict} />
            </div>
          </nav>
        </div>
      </aside>
      <div className="admin-stage">
        <header className="admin-topbar">
          <p className="admin-crumbs" aria-label={c.location}>
            <span>{group ? c.groups[group] : c.legacy}</span>
            <span aria-hidden="true">›</span>
            <span className="admin-crumbs-here">{c.nav[active]}</span>
          </p>
          <WorkspaceLanguage
            locale={locale}
            label={dictionary.nav.localeToggle}
          />
        </header>
        <main id="main" className="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
