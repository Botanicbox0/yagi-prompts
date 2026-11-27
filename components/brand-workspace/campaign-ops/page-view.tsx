import type { RoomTrack } from '@/lib/brand-rooms/overview';
import type { BrandProjectSummary } from '@/lib/brands/workspace/types';
import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import type { BrandCopy } from '../action-form';
import type { CampaignListRooms } from '../campaign-list';
import { ProcessStage } from '../process-stage';
import { CampaignOpsAfterHeader } from './header-after';
import {
  campaignOpsPageState,
  campaignOpsStartHref,
  campaignOpsSteps,
  type CampaignOpsKind,
} from './model';
import { CampaignOpsList } from './ops-list';
import s from './campaign-ops.module.css';

export interface CampaignOpsPageViewProps {
  kind: CampaignOpsKind;
  organizationId: string;
  projects: readonly BrandProjectSummary[];
  canRequest: boolean;
  locale: 'ko' | 'en';
  copy: CampaignOpsCopy;
  b: BrandCopy;
  rooms: CampaignListRooms;
  trackLabels: Record<RoomTrack, string>;
}

export function CampaignOpsPageView({
  kind,
  organizationId,
  projects,
  canRequest,
  locale,
  copy,
  b,
  rooms,
  trackLabels,
}: CampaignOpsPageViewProps) {
  const section = kind === 'campaigns' ? copy.campaigns : copy.production;
  const pageTitle = copy.rail[kind];
  const state = campaignOpsPageState(projects);
  const startHref = campaignOpsStartHref(kind, organizationId);
  const steps = campaignOpsSteps(kind, copy);

  return (
    <div className={s.page} data-campaign-ops-page={kind} data-state={state}>
      {state === 'before' ? (
        <>
          <header className={s.beforeHead}>
            <h1 className={s.pageTitle}>{pageTitle}</h1>
            <p className={s.lead}>{section.lead}</p>
          </header>

          <section className={s.hero} data-campaign-ops-hero="">
            <div className={s.heroCopy}>
              <h2 className={s.heroTitle}>{section.hero.title}</h2>
              <p className={s.heroBody}>{section.hero.body}</p>
            </div>
            {canRequest ? (
              <a
                href={startHref}
                className={`bs-btn ${s.heroAction}`}
                data-variant="solid"
                data-size="md"
                data-campaign-ops-start=""
              >
                {section.hero.cta}
              </a>
            ) : null}
          </section>

          <section className={s.howSection} aria-labelledby="campaign-ops-how-heading" data-campaign-ops-how="">
            <h2 id="campaign-ops-how-heading" className={s.howTitle}>
              {section.how.title}
            </h2>
            <ProcessStage
              steps={steps}
              ariaLabel={section.how.title}
              exampleCaption={section.how.example}
              pic={copy.pic}
              variant="page"
            />
          </section>
        </>
      ) : (
        <>
          <CampaignOpsAfterHeader
            title={pageTitle}
            howTitle={section.how.title}
            closeLabel={copy.shared.howClose}
            exampleCaption={section.how.example}
            steps={steps}
            pic={copy.pic}
            startHref={startHref}
            ctaLabel={section.hero.cta}
            canRequest={canRequest}
          />
          <CampaignOpsList
            kind={kind}
            organizationId={organizationId}
            projects={projects}
            listTitle={section.list.title}
            listEmpty={section.list.empty}
            allLabel={copy.shared.filterAll}
            b={b}
            locale={locale}
            rooms={rooms}
            trackLabels={trackLabels}
          />
        </>
      )}
    </div>
  );
}
