-- 클라우드 적용 필요. Creator collaboration never grants organization membership.
create table campaign_collaboration_links (
 campaign_id uuid primary key references campaigns(id), project_id uuid not null references brand_projects(id),
 created_by uuid not null references profiles(id), created_at timestamptz not null default now()
);
create index campaign_collaboration_links_project on campaign_collaboration_links(project_id);
-- All application entry points serialize with payout edits, including the existing public apply form.
create function lock_campaign_application_terms() returns trigger language plpgsql as $$ begin
 perform id from campaigns where id=new.campaign_id for update;return new;
end $$;
create trigger campaign_application_terms_lock before insert on campaign_applications for each row execute function lock_campaign_application_terms();
create function guard_campaign_accepted_payout() returns trigger language plpgsql as $$ begin
 if old.payout is distinct from new.payout and exists(select 1 from campaign_applications where campaign_id=old.id) then raise exception 'campaign payout terms immutable after application';end if;return new;
end $$;
create trigger campaign_accepted_payout before update of payout on campaigns for each row execute function guard_campaign_accepted_payout();
create function guard_campaign_collaboration_binding() returns trigger language plpgsql as $$ begin
 if exists(select 1 from campaign_collaboration_links l join brand_production_contracts c on c.id=new.contract_id where l.campaign_id=new.campaign_id and l.project_id<>c.project_id) then raise exception 'campaign collaboration project conflict';end if;
 return new;
end $$;
create trigger campaign_collaboration_binding before insert or update on campaign_productions for each row execute function guard_campaign_collaboration_binding();
create table campaign_participant_invites (
 id uuid primary key, campaign_id uuid not null references campaign_collaboration_links(campaign_id),
 token_hash text not null unique check(length(token_hash)=64), email text,
 created_by uuid not null references profiles(id), request_id uuid not null,
 expires_at timestamptz not null, revoked_at timestamptz,
 accepted_by uuid references profiles(id), application_id uuid references campaign_applications(id),
 accepted_fingerprint text, accepted_terms_version text, accepted_terms_snapshot jsonb check(jsonb_typeof(accepted_terms_snapshot)='object'), accepted_at timestamptz, created_at timestamptz not null default now(),
 unique(created_by,request_id), check((accepted_by is null)=(accepted_at is null)),
 check((accepted_at is null)=(application_id is null)), check((accepted_at is null)=(accepted_fingerprint is null)), check((accepted_at is null)=(accepted_terms_version is null)), check((accepted_at is null)=(accepted_terms_snapshot is null))
);
create index campaign_participant_invites_campaign on campaign_participant_invites(campaign_id,created_at);
create table campaign_participant_messages (
 id uuid primary key, application_id uuid not null references campaign_applications(id),
 created_by uuid not null references profiles(id), author_role text not null check(author_role in ('creator','brand','studio')),
 body text not null check(length(body) between 1 and 4000), request_id uuid not null,
 created_at timestamptz not null default now(), unique(created_by,request_id)
);
create index campaign_participant_messages_application on campaign_participant_messages(application_id,created_at,id);
create table campaign_participant_files (
 id uuid primary key, application_id uuid not null references campaign_applications(id),
 created_by uuid not null references profiles(id), author_role text not null check(author_role in ('creator','brand','studio')),
 request_id uuid not null, name text not null check(length(name) between 1 and 120),
 mime text not null check(mime in ('application/pdf','image/png','image/jpeg','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 3000000), sha256 text not null check(length(sha256)=64),
 storage_key text not null unique, status text not null default 'pending' check(status in ('pending','ready')),
 created_at timestamptz not null default now(), unique(created_by,request_id)
);
create index campaign_participant_files_application on campaign_participant_files(application_id,created_at,id);
create table campaign_participant_access_audit (
 id uuid primary key, application_id uuid not null references campaign_applications(id),
 actor_id uuid not null references profiles(id), purpose text not null check(purpose='participant_support'),
 created_at timestamptz not null default now()
);
create function guard_campaign_collaboration_immutable() returns trigger language plpgsql as $$ begin
 if tg_op='DELETE' then raise exception 'participant collaboration record immutable';end if;
 if tg_table_name='campaign_participant_files' then
  if (to_jsonb(old)-'status') is distinct from (to_jsonb(new)-'status') or old.status='ready' then raise exception 'participant file immutable';end if;
 elsif tg_table_name='campaign_participant_invites' then
  if (old.id,old.campaign_id,old.token_hash,old.email,old.created_by,old.request_id,old.expires_at,old.created_at)
   is distinct from (new.id,new.campaign_id,new.token_hash,new.email,new.created_by,new.request_id,new.expires_at,new.created_at)
   or old.accepted_at is not null and (old.accepted_by,old.application_id,old.accepted_fingerprint,old.accepted_terms_version,old.accepted_terms_snapshot,old.accepted_at) is distinct from (new.accepted_by,new.application_id,new.accepted_fingerprint,new.accepted_terms_version,new.accepted_terms_snapshot,new.accepted_at)
   or old.revoked_at is not null and old.revoked_at is distinct from new.revoked_at then raise exception 'participant invitation immutable'; end if;
 else raise exception 'participant collaboration record immutable'; end if;
 return new;
end $$;
create trigger campaign_file_immutable before update or delete on campaign_participant_files for each row execute function guard_campaign_collaboration_immutable();
create trigger campaign_invite_immutable before update or delete on campaign_participant_invites for each row execute function guard_campaign_collaboration_immutable();
create trigger campaign_link_immutable before update or delete on campaign_collaboration_links for each row execute function guard_campaign_collaboration_immutable();
create trigger campaign_message_immutable before update or delete on campaign_participant_messages for each row execute function guard_campaign_collaboration_immutable();
create trigger campaign_access_immutable before update or delete on campaign_participant_access_audit for each row execute function guard_campaign_collaboration_immutable();
do $$ declare t text;begin
 foreach t in array array['campaign_collaboration_links','campaign_participant_invites','campaign_participant_messages','campaign_participant_files','campaign_participant_access_audit'] loop
 execute format('alter table %I enable row level security',t);execute format('alter table %I force row level security',t);execute format('revoke all on %I from public',t);
 end loop;
end $$;
