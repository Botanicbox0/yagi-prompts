-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0170 — project room guest invitation posture (pairs with 0097)
-- brand_invites stays RLS-forced with no policies and no browser access (0113). The server role gets
-- exactly the new column updates: the invitation mail's outcome, and the account e-mail recorded when a
-- project invitation is accepted. Tokens are never updated: a re-sent invitation is a new row and the old
-- one is revoked (revoked_at, already granted).
alter table public.brand_invites enable row level security;
alter table public.brand_invites force row level security;
revoke all on public.brand_invites from public, anon, authenticated;
grant update(mail_state, mail_sent_at, accepted_email) on public.brand_invites to service_role;
