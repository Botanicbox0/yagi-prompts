-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0180 — add 'ops_alert' kind to team_notice_deliveries
--
-- Extends the `team_notice_deliveries` kind check constraint with `'ops_alert'` so the 10-minute
-- studio ops alert pass can enqueue aggregate failure-rate and stale-lane notices through the
-- durable outbox. Safe to deploy in either order: application code checks whether `'ops_alert'` is
-- allowed before enqueueing and skips quietly on pre-0180 schemas. Pairs with glue migration 0181.

do $$
declare
  c record;
begin
  if to_regclass('public.team_notice_deliveries') is null then
    return;
  end if;

  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.team_notice_deliveries'::regclass
       and con.contype = 'c'
       and exists (
         select 1
           from pg_attribute a
          where a.attrelid = con.conrelid
            and a.attnum = any (con.conkey)
            and a.attname = 'kind'
       )
  loop
    execute format('alter table public.team_notice_deliveries drop constraint %I', c.conname);
  end loop;

  alter table public.team_notice_deliveries
    add constraint team_notice_deliveries_kind_check check (kind in (
      'support_message',
      'concierge_escalation',
      'project_request',
      'room_message',
      'storyboard_approval',
      'review_comment',
      'share_guest_note',
      'org_created',
      'allowance_request',
      'plan_request',
      'ops_alert'
    ));
end
$$;
