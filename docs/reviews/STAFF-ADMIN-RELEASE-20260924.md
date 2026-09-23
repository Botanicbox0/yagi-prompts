# Company admin repair and secondary-usage release verification — 2026-09-24

## Reported fault and fix

A company account had a confirmed `auth.users` email and an existing profile with `is_admin=false`.
The login callback never derived the admin role; the company-domain rule only granted brand browsing.
The same real-account server probe failed with `NOT_ADMIN` before the migration and passed afterwards.

0038/0124 derives automatic admin rights from the auth server's confirmed exact company domain,
tracks manual versus automatic grants, and synchronizes new profiles, confirmation, email changes,
bans and soft deletion. Only automatic grants are revoked. Client/profile email metadata never grants
rights. A failed revocation aborts the corresponding auth change; per-user transaction locks serialize
first-profile creation against email changes. Manual admin offboarding remains explicit (SETUP §4).

Brand workspaces remain accessible through the normal brand selector, with studio operations on the
admin surface. Staff do not impersonate a customer's contract acceptance or payment.

## Independent checks

- Opus 5.5 implemented the patch; a separate Opus 5.5 reviewed authorization and cloud prerequisites.
- Coordinator requested and verified atomic revocation, ban handling and serialization improvements.
- `npx tsc --noEmit`: pass.
- `npx vitest run`: 173 files / 1,886 tests pass (31 new staff authorization tests).
- `npm run db:local`: pass.
- `npm run build:local`: pass.
- `npm run start:local`: actual production server on port 3000, ready.
- `npm run sweep:anon`: **SWEEP PASSED — 664/664**.
- `git diff --check`: pass.

## Production database — applied 2026-09-24 02:15 KST

First rehearsed all four migrations in one transaction and rolled back. The same final files were then
applied atomically with migration-ledger entries:

| Migration | Version |
| --- | --- |
| 0037_core_brand_usage_licensing | 20260924010001 |
| 0123_glue_brand_usage_licensing | 20260924010002 |
| 0038_core_staff_admin | 20260924010003 |
| 0124_glue_staff_admin | 20260924010004 |

Postconditions: 13 usage tables with forced RLS; zero anon/authenticated SELECT grants; installed auth
sync trigger; 2 eligible company accounts / 2 admins. The reported account is confirmed, admin, and
`admin_source=staff_email`. Its real server-service calls see all 2 organizations and the current
campaign detail. These are read-only service calls using its auth ID, **not an impersonated browser session**.
Two real Postgres sessions verified the per-user lock blocks the second session until the first ends;
this check writes no rows. PGlite covers trigger behavior, revocation fault injection and scope isolation.

Auth settings were checked: `mailer_autoconfirm=false` and `phone_autoconfirm=false`. Company Google
OAuth login was verified in Chrome on both admin and brand hosts; the reported account was not in the
browser account chooser, so no new OAuth login for that person is claimed.

## Release boundaries

- User explicitly authorized production migration and PR merge on 2026-09-24; no direct main push.
- PR #25 carries the feature and repair. Deployment outcome is recorded in the PR and final report.
- GitHub Actions was blocked by account billing/spending limits before jobs started. No checks or
  protection rules were disabled, overridden or relabelled; the complete local gate evidence is above.
- Payment/public-generation flags, keys and legal documents are unchanged. No real charge or outbound
  message was made. Source-file delivery and price prediction remain deferred.
- Private release receipts and raw test logs are in the OS temp folder `twings-staff-release-20260924`.
