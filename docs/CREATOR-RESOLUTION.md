# Creator video resolution and cost floor

Status: implemented on `codex/creator-resolution-pricing` (2026-09-28). Migration 0039 needs cloud
application **before** this code is deployed. No customer price is changed by this work: the
exact prices below are proposals for the founder (AGENTS.md §5).

## 1. Behaviour

| | Before | After |
| --- | --- | --- |
| Provider resolution for a creator film | always 720p (`VIDEO_RESOLUTION`) | the job's own resolution; NULL/legacy = 720p |
| What the buyer sees | one price | 720p (default, pressed) and, when the template has a 1080p price, 1080p with its price. The Pay button names the chosen price. |
| Where the money comes from | `prompt_items.price_krw` | `price_krw` for 720p, `price_1080_krw` for 1080p. The browser sends only `resolution=720p|1080p`. |
| Order | `billing_payments.amount_krw` | + `billing_payments.resolution`; a 1080p order name ends in ` · 1080p`; the order page shows `화질 1080p` / `Resolution 1080p` |
| Confirm | re-derives `price_krw` | re-derives the price **for the order's resolution** (NULL = base price); a change → `price_changed` |
| Render job | no resolution | `render_jobs.resolution`, set from the ORDER row, never from the request; retries re-read the same row |
| Brand production, images | 720p / n.a. | unchanged (brand jobs store 720p; images NULL) |
| Gates | `RENDER_PIPELINE_PUBLIC = false` | unchanged |

Rules live in `lib/twings/resolution.ts`:

- `offeredResolutions` — 720p always for a film for sale; 1080p only if the engine supports it and
  both `price_1080_cents` and `price_1080_krw` are above zero. Images: none.
- `chooseResolution` (checkout) — empty = 720p; unknown or not-offered = `bad_resolution`. Never
  silently downgraded.
- `renderableResolution` (after authorization) — no price gate. A paid 1080p order renders at 1080p
  even if the 1080p price is withdrawn before fulfilment.
- `chargeKrwFor` — the row's own won price for that resolution; NULL resolution = base price, so an
  order created before 0039 confirms against exactly what it did before.

Template example videos do not decide the default. Giant Daydream's approved example is 1080p;
a creator render of it is still 720p unless 1080p is priced and chosen.

## 2. Cost evidence (checked 2026-09-28)

| Source | Figure |
| --- | --- |
| `lib/ark/models.ts` (ModelArk pricing page, 2026-08-31) | Seedance 2.5: $0.103 / $0.231 / $0.569 per second at 480p / 720p / 1080p. Seedance 2.0: $0.07 / $0.15 / $0.37 (4k $0.78). 16:9, no video input. |
| Public price aggregators, Sept 2026 (CometAPI, CellCog, Actoria) | 2.5 at $10.70 per million tokens without video input; a 5-second 16:9 clip is $0.514 / $1.156 / $2.843 at 480p / 720p / 1080p, i.e. $0.2312 / $0.5686 per second at 720p / 1080p. Matches the table. |
| Production smoke (docs/TEMPLATES-IA.md §12, 2026-09-14) | 2.0 720p 5s = 108,900 tokens = 1280×720×24×5/1024 + ~1%. Confirms token = pixels × fps × seconds / 1024 at 720p. |
| BytePlus docs pages | Render client-side, could not be read by fetch today; the tutorial page shows "last updated 2026-09-24". Re-check the console price before approving. |

What the evidence says about proportionality: 1080p is **2.46×** (2.5) and **2.47×** (2.0) the
720p per-second price, more than the 2.25× pixel ratio. Audio (`generate_audio: true`) is included
in the per-second price, not billed on top. A failed task is not billed. Video input would lower
the per-token rate but add the input duration; creator renders send none. 4:3 and 9:16 differ from
the 16:9 rate by a few percent in tokens.

## 3. Cost floor (proposal)

`lib/twings/cost-model.ts`. Assumptions from docs/TEMPLATES-IA.md §12 (2026-09-17): 1,400원/USD,
+10% for failed renders re-made at our cost, VAT 10% inside the price, PG fee 3.3% of the charged
amount, margin: revenue after VAT ≥ 1.2 × variable cost. That solves to price ≥ ~1.518 × the raw
provider bill, rounded up to the next x,900.

| Model · resolution | 10s | 14s | 15s | 30s |
| --- | --- | --- | --- | --- |
| Seedance 2.0 · 720p | 3,900원 | 4,900원 | 4,900원 | (2.5) |
| Seedance 2.0 · 1080p | 7,900원 | 11,900원 | 11,900원 | (2.5) |
| Seedance 2.5 · 720p | 5,900원 | 6,900원 | 7,900원 | 14,900원 |
| Seedance 2.5 · 1080p | 12,900원 | 17,900원 | 18,900원 | 36,900원 |

These are floors, not recommendations to raise anything. Where a template's current price is above
its 720p floor, the price can come down to the floor and keep the 20% margin; the admin editor now
shows each template's floors next to its price fields and flags a price below one. Where a
template is below its floor today (for example a 15-second Seedance 2.5 film at 5,900원, floor
7,900원), keeping 720p as the default is what makes it viable.

Not modelled: FX moves, fixed costs (asset library plan, storage, mail), and the 4:3 token delta.

## 4. Founder decisions still open

1. The 1080p price for each template (both `price_1080_cents` and `price_1080_krw`). Until set, no
   template offers 1080p.
2. Whether to lower current 720p prices toward the floors in §3, per template.
3. Whether the 20% margin / 10% failure allowance / 1,400원 rate are still the right assumptions.

## 5. Rollout

1. Apply `supabase/migrations/0039_core_creator_resolution.sql` in the cloud (adds three nullable /
   zero-default columns; no RLS change). The code reads the new columns, so deploy after this.
2. Merge and deploy. Behaviour is identical until a 1080p price is set: every order is 720p.
3. Set 1080p prices in the admin editor for templates the founder approves.
