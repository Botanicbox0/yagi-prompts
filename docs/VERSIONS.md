# Pinned versions (M0)

PLAN §7: *"Versions of `next`, `@supabase/ssr`, `@supabase/supabase-js`, `tailwindcss`, `gsap`,
`lenis`, `stripe`, `resend`, `zod` pinned at M0 against current documented contracts."*

Every dependency in `package.json` is an **exact** pin — no `^`, no `~`. Upgrades are deliberate
and post-launch (§10 "framework contract drift").

| Package | Pin | Contract relied upon |
|---|---|---|
| `next` | `15.5.23` | App Router + RSC; **async `cookies()` / `headers()` / `params`** — the Next 15 contract the whole Supabase SSR wiring is written against. Latest npm `latest` is 16.3.0; the plan says **Next.js 15** in §7 and in the M0 checklist, so 15 is pinned at its newest maintenance release. Flagged for Director ratification. |
| `react` / `react-dom` | `19.2.8` | React 19 is what Next 15 App Router targets; Server Actions and `use cache`-era RSC semantics. |
| `typescript` | `5.9.3` | `strict` + `noUncheckedIndexedAccess`; the line Next 15.5's bundled `.d.ts` files are authored against. npm `latest` is TypeScript 7 (native compiler) — deliberately not adopted alongside a Next 15 pin. Flagged. |
| `tailwindcss` / `@tailwindcss/postcss` | `4.3.3` | **CSS-first config**: `@import 'tailwindcss'` + `@theme { … }` in `app/globals.css`, no `tailwind.config.js`. `@custom-variant` for the `data-theme` inversion (§4). |
| `@supabase/ssr` | `0.12.4` | `createServerClient(url, key, { cookies: { getAll, setAll } })` and the middleware refresh pattern: mirror cookies onto request **and** a fresh response, and use `getUser()` (server-verified), never `getSession()`. |
| `@supabase/supabase-js` | `2.112.3` | Service-role client for all data access (§7 factory #2); `maybeSingle()` typing. |
| `gsap` | `3.15.0` | `ScrollTrigger` plugin registration + `scrollerProxy` + `gsap.ticker` driving Lenis' RAF, `lagSmoothing(0)`. |
| `lenis` | `1.3.26` | **Native-scroll mode** (`wrapper: window`, `content: documentElement`, no wrapper transform) so `position: sticky`/`fixed` stay valid (§5.4); `autoRaf: false` because GSAP owns the tick. |
| `stripe` | `22.5.0` | M3: Checkout + customer portal + `constructEvent` signature verification. Not yet imported. |
| `resend` | `6.19.0` | M5: send with an idempotency key `job_id:user_id`. Not yet imported. |
| `zod` | `4.4.3` | `z.discriminatedUnion('kind', …)` for the §6.1 block contracts; `safeParse` at the shaping boundary. |
| `@electric-sql/pglite` | `0.5.4` | In-process Postgres (PG17) for DB acceptance without Docker: `exec()` for migration scripts, `query(text, params)` with `$1` placeholders, `CREATE ROLE` + `SET ROLE` for the publisher-gate tests. |
| `pg` | `8.23.0` | Same `query(text, params) → { rows }` shape as PGlite, so `scripts/seed.ts` runs unchanged against a real `DATABASE_URL`. |
| `vitest` | `4.1.10` | `pool: 'forks'` (PGlite is a single-connection WASM instance per suite). |
| `tsx` | `4.23.12` | Runs `scripts/seed-cli.ts` with the `@/*` path alias. |
| `dotenv` | `17.4.2` | `.env` loading for the seed CLI only; Next loads its own. |
| `server-only` | `0.0.1` | Build-time guard on `lib/supabase/data-client.ts` and `lib/auth/viewer.ts`. |
| `@fontsource/big-shoulders` `@fontsource/anton-sc` `pretendard` `geist` | `5.3.0` / `5.3.0` / `1.3.9` / `1.7.2` | npm-first font sourcing (§5.2). `scripts/copy-fonts.mjs` vendors the WOFF2 + licences into the repo; the packages are build-time sources only. |

## Not adopted, on purpose

- **ESLint** — CI is `typecheck + vitest` per the M0 checklist. Adding a lint stack now means
  pinning another five packages against a moving flat-config target for no acceptance value.
- **Remotion** — explicitly out of v1 (§5.4).
- **A Tailwind config file** — v4 is CSS-first; `app/globals.css` is the single token source.
