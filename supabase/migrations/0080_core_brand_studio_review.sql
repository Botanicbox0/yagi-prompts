-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0080 — brand studio review space (docs/BRAND-STUDIO-V3.md §7)
--
-- Apply this file (and 0155) BEFORE turning on BRAND_STUDIO_V2=on with the v3 review screen. With the
-- flag off nothing reads these tables, so the code can ship first.
--
--   brand_studio_reviews          one piece under review: exactly one studio asset or result of the
--                                 organization. One live review per piece (the second "send to review"
--                                 opens the first). Soft delete.
--   brand_studio_review_comments  feedback on that piece: a whole-piece note, or one tied to a moment
--                                 (at_ms) and optionally a spot in the frame (x, y in 0..1). Replies are
--                                 one level deep (the service enforces the depth; the keys below enforce
--                                 that a reply stays in its review and a comment stays in its
--                                 organization). Soft delete.
--
-- Who wrote what is the audit: created_by/created_role, author_id/author_role ('brand' | 'studio'),
-- resolved_by, status_changed_by. Vocabulary mirrors lib/brand-studio/review-contracts.ts.

create table if not exists brand_studio_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  asset_id uuid references brand_studio_assets(id) on delete cascade,
  output_id uuid references brand_studio_outputs(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  created_by uuid references profiles(id) on delete set null,
  created_role text not null,
  status_changed_by uuid references profiles(id) on delete set null,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_studio_reviews_subject check (num_nonnulls(asset_id, output_id) = 1),
  constraint brand_studio_reviews_title check (char_length(title) between 1 and 120),
  constraint brand_studio_reviews_status check (status in ('open','changes_requested','approved')),
  constraint brand_studio_reviews_role check (created_role in ('brand','studio')),
  constraint brand_studio_reviews_org_key unique (id, organization_id)
);
create unique index if not exists brand_studio_reviews_asset_key on brand_studio_reviews (organization_id, asset_id)
  where deleted_at is null and asset_id is not null;
create unique index if not exists brand_studio_reviews_output_key on brand_studio_reviews (organization_id, output_id)
  where deleted_at is null and output_id is not null;
create index if not exists idx_brand_studio_reviews_org on brand_studio_reviews (organization_id, updated_at desc) where deleted_at is null;
create index if not exists idx_brand_studio_reviews_recent on brand_studio_reviews (updated_at desc) where deleted_at is null;

create table if not exists brand_studio_review_comments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  parent_id uuid,
  author_id uuid references profiles(id) on delete set null,
  author_role text not null,
  body text not null,
  -- null = about the whole piece; otherwise the moment in the film (0 for a still image spot).
  at_ms integer,
  x real,
  y real,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_studio_review_comments_review_fk foreign key (review_id, organization_id)
    references brand_studio_reviews (id, organization_id) on delete cascade,
  constraint brand_studio_review_comments_thread_key unique (id, review_id),
  constraint brand_studio_review_comments_parent_fk foreign key (parent_id, review_id)
    references brand_studio_review_comments (id, review_id) on delete cascade,
  constraint brand_studio_review_comments_role check (author_role in ('brand','studio')),
  constraint brand_studio_review_comments_body check (char_length(body) between 1 and 2000),
  constraint brand_studio_review_comments_at check (at_ms is null or at_ms between 0 and 86400000),
  constraint brand_studio_review_comments_spot check ((x is null) = (y is null)),
  constraint brand_studio_review_comments_x check (x is null or (x >= 0 and x <= 1)),
  constraint brand_studio_review_comments_y check (y is null or (y >= 0 and y <= 1)),
  constraint brand_studio_review_comments_parent check (parent_id is null or parent_id <> id),
  constraint brand_studio_review_comments_resolved check (resolved_by is null or resolved_at is not null)
);
create index if not exists idx_brand_studio_review_comments_review on brand_studio_review_comments (review_id, created_at);
create index if not exists idx_brand_studio_review_comments_author on brand_studio_review_comments (author_id, created_at desc);
create index if not exists idx_brand_studio_review_comments_parent on brand_studio_review_comments (parent_id) where parent_id is not null;
