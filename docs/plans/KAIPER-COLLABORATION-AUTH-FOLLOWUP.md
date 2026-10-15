# Campaign invitation authentication follow-up

2026-10-16. Local implementation; production unchanged.

## Confirmed integration defect

The original middleware session gate redirected an anonymous `/campaigns/{slug}/join` request before its client component could capture the invitation fragment. A fragment is not sent to the server, so the login redirect could not preserve it. A route-classification test alone did not detect this defect.

`tests/routes/campaign-join-middleware.test.ts` reproduced the failure through the actual exported middleware: the anonymous landing had no `x-middleware-next` response. After the fix, GET and HEAD pass through with `private, no-store` and `noindex, nofollow`. The exception matches only the join landing; POST and existing participation, make, apply and mine session gates remain unchanged. The landing renders existing public campaign terms. The claim API still requires a signed-in account and independently checks token, optional verified email, campaign terms, expiry, revocation and ownership.

## Browser transfer

`lib/campaigns/collaboration/invitation-transfer.ts` stores a validated token and an absolute 24-hour expiry in session storage. Reads discard expired, malformed and legacy unbounded entries. The server invitation expiry remains authoritative and can expire earlier. Tokens are removed from the address fragment after capture and never added to an OAuth URL, server query, cookie or server-rendered prop.

If browser storage is blocked, a fresh fragment remains available in component memory for an already signed-in account. An anonymous reader receives an explicit instruction to sign in and reopen the original invitation. Storage cleanup failure after successful acceptance cannot prevent navigation to the participation.

`BrowserAddress` also handles the existing Instagram/webview external-browser flow: it reconstructs a copyable address with a fragment only for the exact campaign join path on the current origin. It rejects other campaigns, other origins, OAuth targets, query strings and malformed slugs. The external browser captures that fragment into its own session storage before authentication.

## Evidence and limits

- Initial actual middleware test: 1 failed, 2 passed; anonymous GET/HEAD landing assertion reproduced the redirect defect.
- After fix: `npx vitest run tests/routes/campaign-join-middleware.test.ts tests/campaigns/invitation-transfer.test.ts tests/auth/invitation-transfer.test.ts tests/ui/campaign-collaboration.test.tsx` — 4 files / 14 tests passed.
- Tests cover same-browser OAuth restoration, 24-hour expiry, invalid/legacy entries, blocked storage, external-browser reconstruction, forbidden destinations and private-route/method gates.
- Browser visual and live OAuth verification remain unperformed because the parent task's browser policy loader was blocked. These tests establish code boundaries and deterministic transfer behavior, not live Instagram or OAuth completion.

Include this defect, fix and remaining browser limitation in the Opus implementation review.
