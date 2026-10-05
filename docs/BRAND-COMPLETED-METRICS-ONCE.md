# One completed campaign, one metrics save

The owner approved a single update to one completed campaign on 2026-10-06. Normal
collection still stops at completion. Single-post measurement entry, external
imports, cancelled campaigns and every other completed campaign remain closed.

An operator may configure the **server-only** environment variable
`BRAND_COMPLETED_METRICS_ONCE` as a strict JSON object containing `projectId`,
`requestId` (two UUIDs), and `expiresAt` (a future ISO timestamp with timezone).
Generate one fixed request UUID for the entire update. Do not change that UUID to
obtain another save. No real customer identifiers or measurements belong in Git.
Missing, malformed, expired or differently scoped configuration grants nothing.

The configured campaign's existing `/admin/do` collection console offers one
combined save. Select all intended rows and check **all five counts** before
submitting. Unknown remains blank; rounded public views must be marked approximate.
Do not copy old likes or comments and claim they were checked now. A campaign with
more than 50 selected posts is outside this exception's supported scope.

The service rechecks the real administrator profile and configuration under the
existing campaign row lock. The immutable collection ledger consumes the exact
request across all administrators. A stale, missing or foreign post rolls back
the whole transaction without consuming it. Successful retries with the same
author and payload return the stored result; a changed payload or another author
cannot append a second batch. The campaign remains completed. Measurement history
and existing report snapshots remain immutable. A new report may subsequently be
published from the updated latest values.

After a successful save, the console is closed again even if the environment
variable remains set. Remove the variable after verifying the result. This change
requires code deployment and operator configuration; it does not execute a cloud
migration or change any production measurements by itself.
