# PLAYBOOK (working title)

The open production floor of an AI studio - bilingual (ko/en) step-by-step AI-media workflow playbooks.

Execution contract: [PLAYBOOK-PLAN.md](./PLAYBOOK-PLAN.md) (v1.4, cross-validated READY).
Milestones: M0-M5 per plan section 8. Director: Claude (Fable). Executor: Opus.

## Status

**M0 Foundation** — scaffold, tokens + fonts, motion shell, locale routing, route skeletons,
the full section 6 schema with the two-phase publish RPCs, and fixtures published through the real
prepare -> copy -> publish flow. No landing scenes (M1), no renderers (M2), no Stripe (M3),
no admin editor (M4), no notifications (M5).

## Run it

```powershell
npm install
npm run check   # typecheck + vitest — what CI runs
npm run dev
```

No external service is required for local development or for the test suite: DB acceptance runs on
PGlite in-process, and storage uses the local filesystem driver under `.storage/`.

## Where things are

| Path | What |
|---|---|
| `app/(marketing)/[locale]/` | public, locale-prefixed, static + `catalog` tag + 1h TTL |
| `app/(app)/`, `app/(admin)/` | authenticated surfaces, `force-dynamic` + `private, no-store` |
| `app/globals.css` | the single design-token source (Tailwind v4 CSS-first, section 5.1/5.2) |
| `lib/content/` | zod block contracts, the shared visibility resolver, the pure `shapeRevision` |
| `lib/publish/` | phase B of publication (the storage copier) around the two DB RPCs |
| `lib/storage/` | bucket semantics behind one interface; local driver now, Supabase driver later |
| `supabase/migrations/` | core (PGlite-testable) + supabase-glue split — see `supabase/README.md` |
| `scripts/seed.ts` | 2 fixture playbooks, every block kind x visibility, published for real |
| `docs/` | `VERSIONS.md` (why each pin), `SETUP.md` (manual steps remaining) |
