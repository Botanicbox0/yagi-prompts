import {
  ADMIN_NAV_GROUPS,
  ADMIN_NAV_PATHS,
  type AdminNavKey,
} from "@/lib/admin/workflow";
import { WorkspaceLanguage } from "@/components/brand-workspace/language";
import { PublicLink } from "@/components/admin/public-link";
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
  "border border-hairline px-3 py-1.5 font-label text-eyebrow uppercase hover:border-accent hover:text-accent";
export const BUTTON_PRIMARY =
  "border border-accent bg-accent px-4 py-2 font-label text-eyebrow uppercase text-white";
export const INPUT =
  "w-full border border-hairline bg-transparent px-2.5 py-1.5 font-mono text-code outline-none focus:border-accent";
export const LABEL = "block font-label text-eyebrow uppercase opacity-60";

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
      {hint && (
        <span className="mt-1 block font-mono text-[0.72rem] opacity-50">
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
        <span className="font-label text-[0.68rem] uppercase tracking-[0.12em] opacity-45">
          {tag}
        </span>
        {multiline ? (
          <textarea
            name={field}
            rows={rows}
            defaultValue={current}
            className={`${INPUT} mt-1`}
          />
        ) : (
          <input
            type="text"
            name={field}
            defaultValue={current}
            className={`${INPUT} mt-1`}
          />
        )}
      </label>
    );
  };

  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
        {cell("en", "EN")}
        {cell("ko", "KO")}
      </div>
      {hint && (
        <p className="mt-1 font-mono text-[0.72rem] opacity-50">{hint}</p>
      )}
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

export type AdminBadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function AdminBadge({
  tone = "neutral",
  children,
}: {
  tone?: AdminBadgeTone;
  children: ReactNode;
}) {
  return (
    <span className="admin-badge" data-admin-badge={tone}>
      {children}
    </span>
  );
}

export function AdminSectionNav({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{
    id: string;
    label: string;
    count?: number;
    tone?: AdminBadgeTone;
  }>;
}) {
  return (
    <nav className="admin-section-nav" aria-label={ariaLabel} data-admin-section-nav>
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`}>
          <span>{item.label}</span>
          {typeof item.count === "number" && (
            <AdminBadge tone={item.tone ?? (item.count > 0 ? "accent" : "neutral")}>
              {item.count}
            </AdminBadge>
          )}
        </a>
      ))}
    </nav>
  );
}

export function AdminFilterBar({
  ariaLabel,
  items,
  trailing,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{
    href: string;
    label: string;
    count?: number;
    active?: boolean;
  }>;
  trailing?: ReactNode;
}) {
  return (
    <div className="admin-filter-bar" data-admin-filter-bar>
      <nav className="admin-filter-pills" aria-label={ariaLabel}>
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span className="tabular-nums opacity-75">{item.count}</span>
            )}
          </a>
        ))}
      </nav>
      {trailing && <div className="flex flex-wrap items-center gap-2">{trailing}</div>}
    </div>
  );
}

export function AdminFold({
  id,
  summary,
  badge,
  defaultOpen = false,
  children,
}: {
  id?: string;
  summary: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} className="admin-fold" open={defaultOpen} data-admin-fold>
      <summary>
        <span>{summary}</span>
        {badge && <AdminBadge tone="neutral">{badge}</AdminBadge>}
      </summary>
      <div className="admin-fold-body">{children}</div>
    </details>
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

  return (
    <div
      role="status"
      data-outcome={failed ? "error" : "ok"}
      className={`mt-6 border px-4 py-3 ${failed ? "border-accent" : "border-hairline"}`}
    >
      <p className="font-label text-eyebrow uppercase">{String(message)}</p>
      {/* The database's sentence matters when something failed; a slug under "Created." is noise (2026-09-11). */}
      {failed && detail && (
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

export function AdminShell({
  dict,
  locale,
  active,
  children,
}: {
  dict: AdminDict;
  locale: string;
  active: AdminNavKey | "contests";
  children: ReactNode;
}) {
  // "Refresh caches" used to send every page back to /admin; it returns to where it was pressed.
  const refreshBack =
    active === "funding"
      ? "/admin/funding"
      : active === "risk"
        ? "/admin/risk"
        : active === "community"
          ? "/admin/community"
          : active === "landingMedia"
            ? "/admin/landing-media"
          : active === "subscriptions"
            ? "/admin/subscriptions"
            : active === "brandWorkspace"
              ? "/admin/brand-workspace"
              : active === "prompts"
                ? "/admin/prompts"
                : active === "contests"
                  ? "/admin/contests"
                  : active === "campaigns"
                    ? "/admin/campaigns"
                    : active === "inquiries"
                      ? "/admin/inquiries"
                      : active === "policy"
                        ? "/admin/policy"
                        : active === "playbooks"
                          ? "/admin/playbooks"
                          : "/admin";
  const dictionary = getDictionary(isLocale(locale) ? locale : "en");
  const workflow = dictionary.adminWorkflow;
  const entries = [
    ["home", "/admin", dict.navHome],
    ["risk", "/admin/risk", workflow.riskNav],
    ["funding", "/admin/funding", workflow.fundingNav],
    [
      "brandWorkspace",
      "/admin/brand-workspace",
      dictionary.brandWorkspace.studioQueue,
    ],
    ["prompts", "/admin/prompts", dict.navPrompts],
    ["campaigns", "/admin/campaigns", dict.navCampaigns],
    ["inquiries", "/admin/inquiries", dict.navInquiries],
    ["community", "/admin/community", dictionary.community.adminTitle],
    ["landingMedia", "/admin/landing-media", dictionary.landingMedia.nav],
    ["subscriptions", "/admin/subscriptions", dictionary.creatorLaunch.nav],
    ["playbooks", "/admin/playbooks", dict.navPlaybooks],
    ["policy", "/admin/policy", dict.navPolicy],
  ] as const;
  return (
    <div
      className="admin-workspace"
      data-admin-active={active}
      data-section
      data-theme="light"
    >
      <a href="#main" className="admin-skip-link">
        {workflow.skip}
      </a>
      <aside className="admin-sidebar">
        <AdminBrand dict={dict} />
        <nav data-admin-navigation aria-label={workflow.navigation}>
          {ADMIN_NAV_GROUPS.map((group) => (
            <section
              key={group.key}
              className="admin-nav-group"
              aria-labelledby={`admin-nav-${group.key}`}
            >
              <h2 id={`admin-nav-${group.key}`}>
                {workflow.groups[group.key]}
              </h2>
              {group.items.map((key) => (
                <a
                  key={key}
                  href={ADMIN_NAV_PATHS[key]}
                  aria-current={active === key ? "page" : undefined}
                >
                  <span>{entries.find(([entry]) => entry === key)?.[2]}</span>
                  <span className="admin-nav-description">
                    {workflow.descriptions[key]}
                  </span>
                </a>
              ))}
            </section>
          ))}
        </nav>
        <div className="admin-utilities">
          <PublicLink href={`/${locale}`}>{dict.navSite} ↗</PublicLink>
          <OpForm op="caches.refresh" back={refreshBack}>
            <button type="submit">{dict.refreshCaches}</button>
          </OpForm>
          <AdminSignOut dict={dict} />
        </div>
      </aside>
      <div className="admin-body">
        <header className="admin-topbar">
          <span>
            {entries.find(([key]) => key === active)?.[2] ?? dict.brand}
          </span>
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
