-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0056 — brand campaign wizard (docs/PLATFORM-2.0.md §16.3, §16.6, 2026-10-23)
--
-- Apply this file (and 0140) BEFORE deploying the code that reads it: the public campaign list
-- filters on `campaigns.audience`, and a brief sent from the wizard writes `campaign_terms`.
--
--   brand_projects.campaign_terms   what the brand chose in the five-step wizard (format, reward and
--                                   budget, audience, dates and posting rules), validated by
--                                   `lib/brands/workspace/campaign-terms.ts` before it is written.
--                                   NULL for briefs sent before the wizard or by the studio. It is a
--                                   request, not the campaign: TWINGS still creates the `campaigns`
--                                   row in /admin/campaigns, pre-filled from these terms.
--   campaigns.audience              who may see a campaign: `public` (the marketing list),
--                                   `influencers` (signed-in qualified accounts) or `invited`
--                                   (only the accounts in campaign_targets). Existing rows stay
--                                   `public`. Viewer-specific visibility is slice B2.
--   campaign_targets                the accounts an `invited` campaign is shown to. Columns and
--                                   keys only in B1; nothing reads it yet.
--   campaign_applications.brand_preferred_at
--                                   the brand marked this applicant as preferred. A hint to TWINGS
--                                   only: selection stays a TWINGS decision (KAIPER principle).

alter table brand_projects add column if not exists campaign_terms jsonb;
alter table brand_projects drop constraint if exists brand_projects_campaign_terms_object;
alter table brand_projects add constraint brand_projects_campaign_terms_object
  check (campaign_terms is null or jsonb_typeof(campaign_terms) = 'object');

alter table campaigns add column if not exists audience text not null default 'public';
alter table campaigns drop constraint if exists campaigns_audience_check;
alter table campaigns add constraint campaigns_audience_check
  check (audience in ('public','influencers','invited'));

create table if not exists campaign_targets (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  invited_by uuid references profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index if not exists idx_campaign_targets_user on campaign_targets (user_id);

alter table campaign_applications add column if not exists brand_preferred_at timestamptz;
