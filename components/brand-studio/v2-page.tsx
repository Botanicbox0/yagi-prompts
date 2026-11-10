/**
 * `/brand/studio` when studio v2 is open for the selected brand (docs/BRAND-STUDIO-V2.md §5.2–5.3):
 * the 만들기 tab (the client studio) and the 포맷 tab (contract templates, or two ways to start one).
 *
 * The page calls this only after its sandbox/denied `notFound()` and only when
 * `brandStudioV2Open() && studioV2Visible(choice, true)`. All data is awaited here so the tree that
 * comes back is plain markup plus one client island.
 */
import type { ReactElement } from "react";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { selectedAccess } from "@/components/brand-workspace/scope";
import { membershipOf } from "@/components/brand-workspace/scope";
import { assetLibraryMode, identityStatusFor, needsLiveness } from "@/lib/identity/service";
import { currentSelfie } from "@/lib/identity/selfie-service";
import { loadProductionWorkspace } from "@/lib/brands/production/service";
import { studioRequestStatus, studioStage } from "@/lib/brands/production/stage";
import { loadBrandSupport } from "@/lib/brands/workspace/service";
import { scopedHref, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ContractProduction } from "./contract-production";
import type { StudioLocale } from "./copy";
import { StudioApp } from "./studio-app";

const REQUEST_TITLES = [getDictionary("ko"), getDictionary("en")].map((d) => d.brandWorkspace.studioInquiry.messageTitle);

export type StudioTab = "create" | "formats";
export const studioTab = (value: string | string[] | undefined): StudioTab =>
  (Array.isArray(value) ? value[0] : value) === "formats" ? "formats" : "create";

export interface StudioV2Input {
  deps: { sql: SqlRunner; verifiedEmail?: string };
  viewer: Viewer;
  choice: BrandWorkspaceChoice;
  access: ReturnType<typeof selectedAccess>;
  locale: StudioLocale;
  brandHost: boolean;
  tab: string | string[] | undefined;
  mode: string | string[] | undefined;
}

export async function brandStudioV2(input: StudioV2Input): Promise<ReactElement> {
  const { choice, locale } = input;
  const dict = getDictionary(locale);
  const copy = dict.brandStudio;
  const tab = studioTab(input.tab);
  const mode = (Array.isArray(input.mode) ? input.mode[0] : input.mode) === "video" ? "video" : "image";
  const tabs = [
    { key: "create" as const, href: scopedHref("/brand/studio", choice), label: copy.tabs.create },
    { key: "formats" as const, href: scopedHref("/brand/studio?tab=formats", choice), label: copy.tabs.formats },
  ];
  return (
    <div className="bs-page" data-brand-studio-v2 data-studio-tab={tab}>
      <header className="bs-head">
        <h1 className="bs-title">{copy.title}</h1>
        <div className="bs-head-end">
          <nav className="bs-tabs" aria-label={copy.tabs.label}>
            {tabs.map((t) => (
              <a key={t.key} className="bs-tab" href={t.href} aria-current={tab === t.key ? "page" : undefined} data-selected={tab === t.key ? "" : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
          {/* The phone's "에셋 보기" button is placed here by the studio (studio-app.tsx). */}
          {tab === "create" && <div className="bs-head-slot" data-studio-head-slot />}
        </div>
      </header>
      {tab === "formats" ? (
        await formatsTab(input)
      ) : (
        <StudioApp organizationId={choice.id} locale={locale} copy={copy} initialMedium={mode} />
      )}
    </div>
  );
}

async function formatsTab({ deps, viewer, choice, access, locale, brandHost }: StudioV2Input): Promise<ReactElement> {
  const dict = getDictionary(locale);
  const copy = dict.brandStudio.formats;
  const t = dict.brandWorkspace.productionStudio;
  const orgId = membershipOf(choice)[0]?.id;
  const historyOrg = orgId ?? (access.staff ? choice.id : undefined);
  const production = historyOrg ? await loadProductionWorkspace(deps, viewer, historyOrg) : null;
  const contracts = production?.contracts ?? [];
  const support = !contracts.length && orgId ? await loadBrandSupport(deps, viewer, orgId) : null;
  const request = support ? studioRequestStatus(support, REQUEST_TITLES) : null;
  const canRequest = !access.staff && (access.canRequest || access.fresh);
  const stage = studioStage({ contracts, canRequest, request });
  const canCreate = !access.staff && production?.role !== "viewer";
  const hasTemplates = contracts.some((c) => c.templates.length > 0);
  const selfie = hasTemplates ? ((await currentSelfie(deps.sql, viewer.userId!))?.id ?? null) : null;
  const libraryMode = assetLibraryMode();
  const verifyRequired =
    !!selfie && needsLiveness("seedance-2.5", libraryMode) && (await identityStatusFor(deps.sql, viewer.userId!, libraryMode)) !== "active";

  if (contracts.length)
    return (
      <section className="bs-formats" data-studio-formats="contracts">
        <ContractProduction
          production={production}
          contracts={contracts}
          stage={stage}
          canCreate={canCreate}
          staff={access.staff}
          verifyRequired={verifyRequired}
          selfie={selfie}
          orgId={orgId}
          historyOrg={historyOrg}
          locale={locale}
          brandHost={brandHost}
          t={t}
          o={t.onboarding}
        />
      </section>
    );
  return (
    <section className="bs-formats" data-studio-formats="start">
      {request && (
        <p className="bs-notice" data-studio-request={request.answered ? "answered" : "waiting"}>
          {request.answered ? t.onboarding.answeredTitle : t.onboarding.requestedTitle}
        </p>
      )}
      <p className="bs-lead">{copy.lead}</p>
      <ul className="bs-entries">
        <li>
          <a className="bs-door" href={scopedHref("/brand/studio?mode=video", choice)} data-studio-format-entry="video">
            <span className="bs-door-title">{copy.fromVideo.title}</span>
            <span className="bs-door-line">{copy.fromVideo.line}</span>
            <span className="bs-door-action">{copy.fromVideo.action}</span>
          </a>
        </li>
        {canRequest && (
          <li>
            <a className="bs-door" href={scopedHref("/brand/projects/new?track=template_build", choice)} data-studio-format-entry="commission">
              <span className="bs-door-title">{copy.commission.title}</span>
              <span className="bs-door-line">{copy.commission.line}</span>
              <span className="bs-door-action">{copy.commission.action}</span>
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}
