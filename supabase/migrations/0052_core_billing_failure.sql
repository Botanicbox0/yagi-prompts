-- CLOUD APPLICATION REQUIRED — apply BEFORE deploying the code that reads these columns
-- (the payment reconcile, 다시 결제하기 and the webhook select them).
--
-- docs/PLATFORM-2.0.md §2.2: every Toss one-time order ends in a named state. `failure_code` (0025)
-- already carries the reason ('declined', 'price_changed', 'not_open', 'expired', 'canceled',
-- 'aborted', 'unknown_payment', 'provider_mismatch', 'partial_balance', 'refund_manual',
-- 'fulfil_manual'); this adds what the automatic recoveries need to stop.
--
--   refund_attempts / fulfil_attempts  each automatic recovery stops after 10 tries; the row then
--                                      waits for an operator (`refund_manual` / `fulfil_manual`)
--                                      instead of retrying forever
--   input_deleted_at                   the order's own copy of the photo was removed — an order that
--                                      never became a render (expired, or failed past its window)
--   retried_by                         the order "다시 결제하기" made from this failed one; a second
--                                      press answers with the same order
alter table billing_payments
  add column refund_attempts integer not null default 0 check (refund_attempts >= 0),
  add column fulfil_attempts integer not null default 0 check (fulfil_attempts >= 0),
  add column input_deleted_at timestamptz,
  add column retried_by uuid references billing_payments on delete set null;

-- The reconcile's sweep of unpaid orders past their window.
create index billing_payments_expiring on billing_payments (expires_at)
  where status in ('pending', 'failed') and input_deleted_at is null;
-- The admin dashboard's "결제 확인 필요" count.
create index billing_payments_manual on billing_payments (status)
  where failure_code in ('refund_manual', 'fulfil_manual', 'partial_balance');
