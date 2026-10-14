-- No browser access, even for approved creators. All reads are shaped by authenticated services.
do $$ declare t text; begin
 foreach t in array array['platform_creators','platform_rate_limits','platform_threads','platform_messages','platform_formats','platform_ratings','platform_quality','platform_audit','platform_settlements','platform_reward_policy','platform_claims','platform_image_offers','platform_credit_ledger','platform_redemptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function platform_immutable() from public,anon,authenticated;
revoke all on function platform_private_format() from public,anon,authenticated;
alter function platform_immutable() set search_path=public,pg_temp;
alter function platform_private_format() set search_path=public,pg_temp;
