# Runbook — account deletion

**Applies to**: a deletion request arriving at `hello@yagiworkshop.xyz` from the "Request deletion"
link on `/account` (PLAN §3.7 — v1 deletion is an honest *request* flow; self-serve deletion is a
post-launch item).

**Commitment we make on that page**: *"we cancel the subscription, delete the account and confirm
within 7 days."* The clock starts when the mail arrives, not when you start work.

**Who runs this**: anyone with Stripe dashboard access and the Supabase service role. It is a
checklist, not a script — every step is a deliberate, verified action.

---

## 0. Before you touch anything

- [ ] The request came **from the account's own email address**. If it did not, reply asking them to
      send it from that address. Do not accept an address change and a deletion in the same thread.
- [ ] Copy the address into this checklist and work from it. Everything below keys off it.
- [ ] Note the request timestamp. `confirmed_by` = request + 7 days.

```sql
-- The one lookup the rest of the runbook uses. Run it in the Supabase SQL editor.
select p.id, p.email, p.plan, p.is_admin, p.stripe_customer_id,
       s.stripe_subscription_id, s.status, s.current_period_end
  from profiles p
  left join subscriptions s on s.user_id = p.id
 where p.email = 'THE-ADDRESS';
```

- [ ] Exactly one row came back. Two rows means two accounts — ask which one, do not guess.
- [ ] `is_admin` is **false**. Deleting a staff account cascades into content authorship history;
      stop and hand it to Yagi.

---

## 1. Cancel the Stripe subscription

Do this **first**. Deleting the profile first would leave a live subscription with no user behind
it, and the next invoice would charge someone who no longer has an account.

- [ ] Stripe dashboard → Customers → the `stripe_customer_id` from step 0.
- [ ] Cancel the subscription **immediately** (not at period end — they asked to leave).
- [ ] If the customer has more than one subscription, cancel all of them and note it (§3.4
      duplicate-subscription policy).
- [ ] Refunds: Stripe defaults, no custom policy (§11 locked default #6). If they asked for one and
      the last invoice is inside Stripe's window, issue it here and say so in the confirmation.
- [ ] Verify: the customer shows **no active subscription**.

```sql
-- Optional but cheap: let our own reconciler write the cancellation down before the row disappears,
-- so the audit trail matches Stripe. Nothing below depends on it.
--   npm run stripe:retry        (or wait for the customer.subscription.deleted webhook)
select status from subscriptions where user_id = 'THE-ID';   -- expect 'canceled'
```

---

## 2. Delete the auth user (profile cascades)

`profiles.id references auth.users on delete cascade`, and `subscriptions`, `notification_deliveries`
and `notification_jobs`'s recipients all hang off `profiles` with `on delete cascade` (§6). Deleting
the auth user therefore removes the account and everything personal attached to it in one step.

- [ ] Supabase dashboard → Authentication → Users → find the address → **Delete user**.
      (Or `supabase.auth.admin.deleteUser(id)` with the service role.)
- [ ] Verify the cascade:

```sql
select count(*) from profiles                where id = 'THE-ID';       -- expect 0
select count(*) from subscriptions           where user_id = 'THE-ID';  -- expect 0
select count(*) from notification_deliveries where user_id = 'THE-ID';  -- expect 0
select count(*) from auth.users              where id = 'THE-ID';       -- expect 0
```

If `profiles` still has a row, the cascade did not run — do **not** delete it by hand until you know
why, because a manual delete would hide the same failure on the next request.

---

## 3. Anonymise the analytics rows

`events.user_id` is a bare `uuid` with **no** foreign key (§6), on purpose: analytics must survive a
deletion. So it does not cascade, and it is the one place a deleted person's id would otherwise
linger.

- [ ] Run it, and read the row count back:

```sql
update events set user_id = null where user_id = 'THE-ID';
-- then, the proof:
select count(*) from events where user_id = 'THE-ID';   -- expect 0
```

The rows themselves stay. `type`, `playbook_id` and `created_at` are not personal data once the user
id is gone, and deleting them would silently rewrite conversion history.

- [ ] Nothing else stores a user id. (Checked against §6: `stripe_events.payload` holds Stripe's own
      objects, keyed by customer, and is Stripe's record of a transaction we are required to keep.)

---

## 4. Confirm, within 7 days

- [ ] Reply to the original thread. Plain, specific, no template voice:

> Your PLAYBOOK account is deleted. The subscription was cancelled on {date} and nothing further
> will be charged. The profile, the subscription record and the notification history are gone; the
> analytics rows that mention you have had the identifier removed.
>
> Stripe keeps its own record of past payments — that is their invoice history, not ours, and we
> cannot delete it.

- [ ] Record the date in the request thread. That is the audit trail.

---

## Checklist summary

| # | Step | Verified by |
|---|---|---|
| 0 | Identity + single account | the lookup query returns exactly one non-admin row |
| 1 | Stripe subscription cancelled | no active subscription on the customer |
| 2 | Auth user deleted, cascade ran | four `count(*) = 0` queries |
| 3 | `events.user_id` anonymised | `count(*) = 0` for that id |
| 4 | Confirmation sent | reply in the request thread, within 7 days |

## Things that are deliberately NOT in this runbook

- **Deleting published content.** Playbooks are admin-authored (§1 "not a community/UGC platform");
  a reader's deletion never removes content.
- **Deleting storage objects.** v1 ships no delete path for published objects (§6 write-once
  posture) and no reader ever uploads one.
- **Deleting `stripe_events`.** They are the payment ledger; see the confirmation wording above.
