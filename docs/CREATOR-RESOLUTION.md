# Creator video resolution and cost floor

Resolution support was implemented on `codex/creator-resolution-pricing` (2026-09-28).
The pricing policy below replaces the original proposal following the founder's 2026-10-09 decision:
no remake or overhead reserves, exchange rate 1,400원/USD, and a margin on revenue excluding VAT —
10% from 2026-10-09, **5% from 2026-10-21** (founder decision; the subscription allowance keeps 10%,
see `SUBSCRIPTION_TARGET_MARGIN` in `lib/twings/subscription-plan.ts`).
Existing sale prices are updated through registered admin operations; this module never writes a price.

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

## 2. Cost evidence (checked 2026-10-09)

| Source | Figure |
| --- | --- |
| [BytePlus ModelArk pricing](https://docs.byteplus.com/en/docs/modelark/model-pricing), updated 2026-10-08 | No video input: Seedance 2.5 $10.70/M output tokens at 720p, $11.70/M at 1080p. Seedance 2.0 $7.00/M and $7.70/M respectively. No contract discount. |
| [Seedance 2.5 output dimensions](https://docs.byteplus.com/zh-TW/docs/modelark/seedance-2-5) | Tokens = width × height × 24 × output seconds / 1024. 720p 16:9 = 1280×720; 9:16 = 720×1280; 4:3 = 1112×834. Quotes use actual aspect ratio rather than a rounded per-second estimate. |
| Production smoke (docs/TEMPLATES-IA.md §12, 2026-09-14) | 2.0 720p 5s = 108,900 tokens = 1280×720×24×5/1024 + ~1%. Confirms token = pixels × fps × seconds / 1024 at 720p. |
| Final provider response | `usage.completion_tokens` is authoritative for reconciliation. |

What the evidence says about proportionality: 1080p is **2.46×** (2.5) and **2.47×** (2.0) the
720p per-second price, more than the 2.25× pixel ratio. Audio (`generate_audio: true`) is included
in the price, not billed on top. A failed task is not billed. Video input would lower
the per-token rate but add the input duration and minimums; creator renders send none.
4:3 costs slightly more than 16:9; 9:16 has the same pixel count as 16:9.

## 3. Minimum-price policy

`lib/ark/pricing.ts` quotes exact tokens. `lib/twings/cost-model.ts` applies 1,400원/USD,
VAT 10% inside the price, and a provisional PG fee of 3.3% of the charged amount.
The target is 5% of revenue excluding VAT after API and PG costs, not a 5% cost markup:

`price = API_KRW / ((1 - 0.05) / 1.10 - 0.033)`, rounded up to the next **100원**.

There is **no remake allowance, arbitrary direct-cost allocation, or FX buffer**.
The actual PG contract must be checked before opening checkout.

| Model · resolution | 10s | 14s | 15s | 30s |
| --- | --- | --- | --- | --- |
| Seedance 2.0 · 720p | 2,600원 | 3,600원 | 3,900원 | (2.5) |
| Seedance 2.0 · 1080p | 6,400원 | 8,900원 | 9,500원 | (2.5) |
| Seedance 2.5 · 720p | 3,900원 | 5,500원 | 5,900원 | 11,700원 |
| Seedance 2.5 · 1080p | 9,600원 | 13,500원 | 14,400원 | 28,800원 |

This table uses 16:9. The admin editor calculates the template's actual aspect ratio; 4:3 is ~0.6%
more pixels than 16:9, which rarely moves the price past a 100-won step.

### Image templates

An image's cost is its engine's, so the floor follows the template's engine (`imageCostFloor`),
one reference photo, the same 5% formula. Per-image costs are the official ones where a page
publishes them (re-read 2026-10-21): Seedream 5.0 Pro $0.09 at 2K with the first reference free,
Lite $0.035 with free references, gpt-image-2 high $0.211 at 1024². OpenAI publishes only token
rates for the two 2.5 models, so both are smoke measurements: sunburst from the 2026-09 run, flare
from the 2026-10-24 run ($0.082 a 1024×1280 xhigh render + $0.012 for the selfie = $0.094).
No image is proposed below **200원** (`IMAGE_MIN_PRICE_KRW`, founder 2026-10-21).

| Engine | Cost | Floor |
| --- | --- | --- |
| Seedream 5.0 Lite | 49원 | 200원 (5% 하한 100원 → 이미지 최소가 200원) |
| Seedream 5.0 Pro | 126원 | 200원 |
| GPT Image 2 | 336원 | 500원 |
| GPT Image 2.5 Flare | 132원 | 200원 (5% 하한 159원 → 이미지 최소가 200원) |
| GPT Image 2.5 Sunburst | 882원 | 1,100원 |
The founder authorized existing priced 720p templates to use this minimum-price rule.
Unpriced templates stay unpriced. USD display prices use the same exchange rate, rounded up to a cent.

Monthly plans use the same provider quote and margin basis; see [CREATOR-SUBSCRIPTION.md](CREATOR-SUBSCRIPTION.md).

## 4. Founder decisions still open

1. The 1080p price for each template (both `price_1080_cents` and `price_1080_krw`). Until set, no
   template offers 1080p.
2. The final PG fee after contract. A change in fees does not silently change public prices.
3. Live billing approval and launch readiness. Preparing a price does not enable checkout.

## 5. Rollout

1. Apply `supabase/migrations/0039_core_creator_resolution.sql` in the cloud (adds three nullable /
   zero-default columns; no RLS change). The code reads the new columns, so deploy after this.
2. Merge and deploy. Behaviour is identical until a 1080p price is set: every order is 720p.
3. Set 1080p prices in the admin editor for templates the founder approves.
