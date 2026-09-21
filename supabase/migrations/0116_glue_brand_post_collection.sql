-- Cloud application required (after 0030). Browser clients authenticate only; no table/RPC access.
-- The batch ledger is append-only: the server role may read and insert, never update or delete.
do $$ declare t text; begin
  foreach t in array array['brand_post_collection_batches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select, insert on public.%I to service_role',t);
  end loop;
end $$;
