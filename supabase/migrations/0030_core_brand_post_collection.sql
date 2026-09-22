-- TWINGS brand post collection console. Cloud application required (apply together with 0116).
-- brand_post_measurements stays the ONLY observation history; brand_posts stays the latest projection.
-- Nothing here adds a second samples table, a schedule, a scraper or any provider call.

-- Revision 0 is the observation entered together with the post. Later observations keep revision>=1.
alter table brand_post_measurements drop constraint brand_post_measurements_revision_check;
alter table brand_post_measurements add constraint brand_post_measurements_revision_check check(revision>=0);

-- One ledger row per console save. It carries the single server-side measurement time of the batch
-- and the digest that lets a retried request be replayed and a changed one be refused.
create table brand_post_collection_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  request_id uuid not null, payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer not null check(row_count between 1 and 50), measured_at timestamptz not null,
  created_by uuid not null references profiles(id), created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(project_id,id), unique(project_id,created_by,request_id)
);
alter table brand_post_measurements add column batch_id uuid;
alter table brand_post_measurements add constraint brand_post_measurements_batch
  foreign key(project_id,batch_id) references brand_post_collection_batches(project_id,id);
create index brand_post_measurements_batch_idx on brand_post_measurements(batch_id) where batch_id is not null;
create index brand_post_measurements_post_time on brand_post_measurements(post_id,measured_at desc);

create trigger immutable_history before update or delete on brand_post_collection_batches
  for each row execute function brand_workspace_immutable();
alter table public.brand_post_collection_batches enable row level security;
alter table public.brand_post_collection_batches force row level security;
revoke all on public.brand_post_collection_batches from public;

-- Backfill: ONLY an initial observation that is really still stored on the post (never revised, so
-- brand_posts still holds exactly what was entered) is copied, with its own measured_at and the
-- post's own creation time and author. A post whose first values were already overwritten by a later
-- revision has lost them; that gap stays a gap. Published report snapshots are not touched.
insert into brand_post_measurements(organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,views,likes,comments,shares,saves,created_by,request_id,created_at)
select p.organization_id,p.project_id,p.id,0,p.verification,p.metrics_source,p.measured_at,p.views,p.likes,p.comments,p.shares,p.saves,p.created_by,p.request_id,p.created_at
from brand_posts p
where p.metric_revision=0 and p.metrics_source<>'unavailable' and p.measured_at is not null
  and not exists(select 1 from brand_post_measurements m where m.post_id=p.id);
