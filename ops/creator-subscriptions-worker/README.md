# Creator subscription scheduler — prepared, not deployed

This package has not been deployed and contains no account ID, API token, or payment key. Its default `SUBSCRIPTION_WORKER_ENABLED = "off"` performs no HTTP calls.

The prepared Cloudflare Cron Trigger runs every 15 minutes. It POSTs only to `https://twings.app/api/creator-subscriptions/tick`, using the private `CRON_SECRET` binding as a bearer token. The same secret must be configured in the TWINGS production environment. No configurable destination or redirects are accepted.

Each endpoint pass claims at most two operations with a 250-second execution budget. Before another operation starts, it reserves 135 seconds for a possible provider lookup plus mutation. Provider leases last 180 seconds. The route has a 300-second maximum duration. The Worker allows 270 seconds per HTTP request and reserves a complete request window within an 840-second total budget, below Cloudflare's 15-minute scheduled invocation limit. It runs at most three batches, continuing only after HTTP success and `{ "ok": true, "hasMore": true }`.

A network timeout, malformed response, redirect, or HTTP failure stops that invocation. There is no blind retry. A later scheduled run reconciles the durable provider order before any same-order payment retry. The Worker never reads an HTTP error body or logs credentials, provider content, or user records.

## Operator activation prerequisites

1. Apply the reviewed cloud migrations and verify the subscription billing keys, dedicated encryption key, and production contract evidence. Test credentials require `CREATOR_SUBSCRIPTION_QA=on`; live maintenance requires production runtime and already-approved matching contract evidence.
2. Use a separately approved Cloudflare account and Wrangler installation. Configure `CRON_SECRET` as an encrypted secret binding through Cloudflare's supported secret interface; never paste it into this file, a shell argument, or a commit.
3. Deploy this package only after operational authorization, enable `SUBSCRIPTION_WORKER_ENABLED=on`, and verify an actual scheduled invocation. Deployment, billing activation, and secret entry are separate operator actions.
4. The founder or Director records the verified `worker` evidence through the protected operational database process. The admin subscription page is read-only; it cannot grant approval. A successful maintenance call refreshes only an already-approved record matching its environment, plan, release, terms, current `VERCEL_GIT_COMMIT_SHA`, and public configuration digest. Missing build identity or changed configuration requires fresh verification; maintenance does not create approval or change `passed`. Previously approved contracts can still recover while fresh launch verification is pending.
5. Confirm the real scheduler invokes the endpoint within the launch freshness window and that interruption recovery, cancellation, refund, and duplicate execution tests pass. An HTTP 200 from a manual request alone is not evidence that Cloudflare scheduling is configured.

The existing Vercel Hobby daily render tick remains unchanged. The prepared Cloudflare Worker is the primary recurring scheduler and must be deployed and verified separately. Do not append up to 250 seconds of billing to a render pass that has already consumed its function execution budget.

## Local validation

The repository's Vitest suite imports this Worker source directly; no Cloudflare dependency installation or deployment is required. Run `npx vitest run tests/creator-subscriptions/maintenance.test.ts tests/creator-subscriptions/worker.test.ts tests/creator-subscriptions/tick-route.test.ts` from the repository root. All provider calls in these tests are mocked.

References: [Cloudflare scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [scheduled invocation wall-time limits](https://developers.cloudflare.com/workers/platform/limits/), [Toss billing API](https://docs.tosspayments.com/reference).
