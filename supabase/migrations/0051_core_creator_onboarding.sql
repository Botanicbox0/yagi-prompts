-- CLOUD APPLICATION REQUIRED. Closed-by-default flags (TWINGS_CREATOR_APPLICATIONS); no applications,
-- creators or notes seeded. Applications are private: they are read only by authenticated services.
create table platform_creator_applications (
 id uuid primary key, user_id uuid not null references profiles on delete cascade,
 display_name text not null check(length(display_name) between 1 and 80),
 portfolio_url text not null check(length(portfolio_url) between 1 and 2048),
 sample_urls text[] not null check(cardinality(sample_urls) between 1 and 3),
 mediums text[] not null check(cardinality(mediums) between 1 and 2 and mediums <@ array['image','video']::text[]),
 tools text not null default '' check(length(tools)<=300),
 message text not null check(length(message) between 20 and 2000),
 rights_at timestamptz not null default now(),
 status text not null default 'submitted' check(status in ('submitted','approved','declined')),
 -- Shown to the applicant. Internal reasons stay in platform_audit.
 decision_note text check(decision_note is null or length(decision_note) between 1 and 1000),
 decided_by uuid references profiles on delete set null, decided_at timestamptz,
 created_at timestamptz not null default now(),
 check((status='submitted')=(decided_at is null)),
 check(status<>'declined' or decision_note is not null)
);
-- One open application per account; a decided one can be followed by a new application.
create unique index platform_creator_applications_open on platform_creator_applications(user_id) where status='submitted';
create index platform_creator_applications_owner on platform_creator_applications(user_id,created_at desc);
create index platform_creator_applications_queue on platform_creator_applications(status,created_at);

-- Creator-facing review feedback, separate from prompt_items.reject_reason (internal moderation text).
alter table platform_formats
 add column review_note text check(review_note is null or length(review_note) between 1 and 1000),
 add column reviewed_at timestamptz,
 add column revision_of uuid references platform_formats on delete set null;
