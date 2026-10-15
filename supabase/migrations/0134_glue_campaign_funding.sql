-- Cloud application required. No authenticated/anonymous Data API access.
do $$ declare t text; begin
 foreach t in array array['campaign_funding_cases','campaign_funding_quotes','campaign_funding_payments','campaign_funding_events','campaign_funding_reward_proposals'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
end $$;
