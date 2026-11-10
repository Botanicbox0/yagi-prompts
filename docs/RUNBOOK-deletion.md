# Runbook — account deletion

**What this covers**: how a TWINGS account is deleted (2026-11-11), what an operator has to do when
the automatic path stops, and how to delete by hand when someone asks by mail.

**Commitment**: privacy policy §3 — *"탈퇴 요청을 받으면 7일 이내에 삭제합니다."* The clock starts at
the request, and the request row's `due_at` is that deadline.

**Stores**: Apple 5.1.1(v) and Google Play's account-deletion policy want deletion to start inside
the app, and Play also wants a public URL. In the app: `/account` → `/account/delete`. Public:
`https://twings.app/ko/delete-account` and `/en/delete-account` (the Play Console "account deletion
URL").

Code: `lib/account/deletion.ts` (rules), `lib/account/deletion-runtime.ts` (storage, sign-in,
provider), `supabase/migrations/0064_core_…` + `0144_glue_…` (table), `/admin/account-deletions`
(queue).

---

## 1. The automatic path

1. **Request.** A signed-in member ticks the box on `/account/delete`. The request is always
   accepted. It records the address, `scheduled_for` (request + grace period) and `due_at`
   (request + 7 days).
2. **Grace period.** 3 days by default (`ACCOUNT_DELETION_GRACE_DAYS`, 0–5). Until the account is
   deleted the member can cancel on `/account` or `/account/delete`.
3. **Daily pass.** `/api/renders/tick` (Vercel Cron, once a day) runs `runDeletionPass` after the
   render and payment passes. Two conditions (`deletionPassGate`), both reported in the tick's
   response as `accountDeletionSkipped`:
   - **`CRON_SECRET` must be set.** Without it the tick is open to anyone, and a pass that deletes
     accounts does not run on an open endpoint (`no_secret`). Confirm the variable exists in Vercel
     Production before relying on the pass.
   - **The render and payment pass before it must have gone through.** If it threw, a refund it owed
     may not have been sent, so no account is deleted that day (`render_pass_failed`).

   For every request past `scheduled_for` it reads the holds (§2).
   - No hold → the account's rows are deleted in **one transaction**. Inside it: the storage folders,
     the provider's assets and their groups are written onto the request (`cleanup`), `events.user_id` is
     emptied, each order's photo is marked gone (`billing_payments.input_deleted_at`), and
     `profiles` is deleted. Everything personal cascades from `profiles`.
   - A hold → nothing is touched. The reason is written on the request (`hold`) and the pass looks
     again the next day.
4. **Cleanup.** Outside the database, from the `cleanup` list: the sign-in account (Supabase Auth
   admin API; ends every session), each private storage folder in the `renders` bucket, then at the
   engine provider every asset (`DeleteAsset`) and, once no asset is left, every group
   (`DeleteAssetGroup`) — all groups the provider may still hold, whatever their state here, except
   `evicted` ones, which were already removed there. A failed item stays on the list with
   `last_error`; the next pass retries. When the list is empty the request becomes `completed` and
   its address is cleared.
5. **If the person signs in again while cleanup is left.** As long as a request lists the sign-in
   account, `/auth/callback` creates no new profile on it: the session is ended and the person sees
   the ordinary sign-in notice. Should a profile exist on that id anyway, the pass does **not**
   remove the sign-in account (it would cascade the new account away): `last_error` says
   `auth: this person signed in again…` and the request waits for an operator (§2, cleanup left).

### What is deleted, what is kept

| Deleted | How |
| --- | --- |
| Profile, notification settings, push subscriptions, social account links | cascade from `profiles` |
| Saved photos (`identity_selfies`, including soft-deleted and replaced rows) and their files | cascade + storage folder `{selfieId}/` |
| Renders: uploaded photo, results, poster, extra frames, share links, feedback | cascade + storage folder `{renderId}/` |
| The photo attached to each order | storage folder `{orderId}/`, `input_deleted_at` set |
| Old portrait attempts, follower screenshots | cascade + their folders |
| Likeness asset rows, and at the provider each asset and its group | cascade + provider `DeleteAsset`, then `DeleteAssetGroup` |
| Free cookies and the prompts they opened (`cookie_ledger` without a purchase, `prompt_unlocks`) | cascade from `profiles` |
| Sign-in account (Google / Kakao link, sessions) | Supabase Auth admin API |
| The id on analytics rows (`events.user_id`) | set to null; the rows stay |

| Kept | Why |
| --- | --- |
| `billing_payments` (amount, order id, Toss payment key, status, timestamps) | 전자상거래법, 5 years (privacy policy §3). `user_id` and `render_id` empty themselves (`on delete set null`); the photo file is gone. The payer can still be identified through Toss by the payment key if a dispute needs it. |
| The request row itself | The record that the 7-day promise was kept: timestamps, counts (`removed`), no address. |

Nothing in this path reads or changes a payment's status, a refund, face verification or provider
review.

---

## 2. Holds — what the queue shows and what to do

`/admin/account-deletions` lists open requests by deadline. The admin home counts a request once it
is held, past its grace period, or stuck in cleanup.

**Waits (clear by themselves; the pass retries daily)**

| Hold | Meaning | Operator |
| --- | --- | --- |
| `render` | A render is held, queued or running. | Nothing. If it has been stuck for days, look at `/admin/renders`. |
| `payment` | An open checkout, an approval being confirmed, a paid order not yet delivered, a refund on its way — or a delivered order whose render then failed (the automatic refund finds that order through its render, so the render must not be deleted first). | Nothing, unless `/admin/payments` shows it needs a hand (`fulfil_manual`, `refund_manual`). Settle it there first. |

**Reviews (need a person)** — the request was accepted; the member was told that our team settles
it first. Settle it, then press **지금 삭제** (or leave it to the next pass). Answer the member at
the address on the request before `due_at` if it cannot be done in time.

| Hold | Meaning | Operator |
| --- | --- | --- |
| `campaign` | Selected, posted or verified in a campaign (a brand is waiting, or a payout is owed), or a paid application (a settlement record kept 5 years, which the cascade would erase). | Finish or withdraw the participation. For paid rows, export the settlement record to the books before deleting. Ask Yagi. |
| `brand` | Member or creator of a brand workspace, or the author of its files, messages or contracts. | The workspace belongs to the brand. Hand the organization to another member or close it with the brand's agreement. Ask Yagi. |
| `creative` | An AI creative: public templates, files other members render from, royalties. | Unpublish or reassign the templates, settle what is owed. Ask Yagi. |
| `subscription` | A monthly plan row (billing key, usage), or a plan from the old payment provider that is still `active` / `past_due` (`subscriptions`). | Cancel the plan at the provider and confirm no charge is pending. The rows are payment records. |
| `staff` | `profiles.is_admin`, or the reviewer account the payment provider and the app stores sign in with (`pg-review…@twings.app`, `lib/auth/review-login.ts`). | Do not delete from the queue. Hand it to Yagi. |
| `records` | A transaction record that would cascade away with the account — a paid cookie pack (`cookie_purchase_events`, a `purchase` line in `cookie_ledger`), an ended plan from the old provider (`subscriptions`) — or some other row that refuses the delete. `last_error` names the table or constraint. | Read `last_error`. For a record kept 5 years, export it to the books before deleting, or leave the account. If a new table should cascade or keep its rows without the owner, that is a migration. Ask Yagi. |

`records` is also the safety net: if the delete is refused by a row nobody listed, the whole
transaction rolls back and the account is exactly as it was.

**지금 삭제** skips the member's grace period, so it asks you to type the account's address first
(`DELETE` when the account has none). A wrong or empty entry changes nothing.

**Cleanup left** (`processing`) — the account's rows are already gone. `last_error` starts with
`auth:`, `files:` or `provider:`. Press **정리 다시 시도**. If an item was removed by hand (a group in
the provider console, a user in the Supabase dashboard), press **완료 표시** with a note saying where.
`auth: this person signed in again…` means a new profile exists on the same sign-in account: do not
delete the sign-in account. Talk to the person, then close the request with **완료 표시** and a note.

**Removed outside this flow** (`requested`, account shown as gone, `last_error` starts with
`account removed outside this flow`) — someone deleted the user in a console. The pass does not
call it done, because the rows that knew where the files and provider assets were went with the
account. Check the `renders` bucket and the provider console by hand (§4 lists what to look for),
then press **완료 표시** with a note saying what you checked.

---

## 3. A request by mail

The public page offers a mail request for people who cannot sign in.

- [ ] The mail came **from the account's own address**. If not, ask them to resend from it. Do not
      accept an address change and a deletion in the same thread.
- [ ] Find the account: `select id, email, is_admin from profiles where email = 'THE-ADDRESS';` —
      exactly one row.
- [ ] Open a request for it, so the same code path does the work and leaves the same record:

```sql
insert into account_deletion_requests (user_id, email, scheduled_for, due_at, note)
select id, email, now(), now() + interval '7 days', 'requested by mail'
  from profiles where id = 'THE-ID';
```

- [ ] `/admin/account-deletions` → **지금 삭제**. Holds apply as in §2.
- [ ] Reply in the thread once the request shows 삭제 완료.

## 4. By hand, if the queue cannot be used

Only when the code path is unavailable. The order matters: files first, because after the rows are
gone nothing remembers which folders belonged to the account.

- [ ] Check §2's holds yourself. Stop at any review hold.
- [ ] List the folders, then remove each from the private `renders` bucket:

```sql
select input_key from identity_selfies where user_id = 'THE-ID'
union all select id::text || '/' from render_jobs where user_id = 'THE-ID'
union all select input_key from billing_payments where user_id = 'THE-ID' and input_key is not null
union all select storage_key from render_slot_inputs where user_id = 'THE-ID';
```

- [ ] `update billing_payments set input_deleted_at = now() where user_id = 'THE-ID' and input_key is not null and input_deleted_at is null;`
- [ ] Note `select asset_id, group_id from identity_assets where user_id = 'THE-ID';` and
      `select group_id from identity_groups where user_id = 'THE-ID' and group_id is not null and status <> 'evicted';`.
      In the provider console delete each asset first, then each group.
- [ ] `update events set user_id = null where user_id = 'THE-ID';`
- [ ] Supabase dashboard → Authentication → Users → **Delete user** (the profile cascades).
- [ ] Verify: `select count(*) from profiles where id = 'THE-ID';` → 0, and
      `select count(*) from billing_payments where id in (…the order ids…);` unchanged.
- [ ] If a request row exists, press **완료 표시** with a note saying what you removed. The pass does
      not close it for you.

## 5. What this runbook does not do

- **Delete payment or settlement records.** They are kept for their legal period.
- **Send mail.** No confirmation mail is sent automatically; the wording of any such mail is the
  founder's decision.
- **Remove posts already on social media or files already downloaded.** We cannot.
