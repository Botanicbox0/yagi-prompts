# Suno v6 through the Sunra API — inputs, prices, and what the two sets of terms say (all read 2026-11-20)

Free, read-only sources: Sunra's public catalogue (`GET https://api.sunra.ai/v1/models?limit=300`), each model's `openapi` schema, the price endpoint, `sunra tools` / `estimate_cost` (free quote), and public web pages. No generation was run. Quotes marked **[V]** were string-matched against the fetched page text.

The founder decided on 2026-11-20 that music runs on Suno through Sunra's API and that Suno music is used commercially in advertising. This file records the evidence and what is not written anywhere; it is a record, not a gate.

## 1. Catalogue: what the API takes and returns

| alias / endpoint | inputs | price |
| --- | --- | --- |
| `suno/suno-v6` `inspire-mode` | `prompt` (required, ≤ 3,000 chars, "Describe the song you want to create"), `instrumental` (default false) | $0.10 per request |
| `suno/suno-v6` `custom-mode` | `title` (required, ≤ 80), `style` (required, ≤ 1,000, "Music styles, moods, and instruments"), `lyrics` (≤ 5,000, "leave empty only for an instrumental"), `instrumental`, `max_mode` ("Spend more compute for a more consistent song; doubles the price") | $0.10; $0.20 with Max Mode |
| `suno/suno-v6-wild` | same two endpoints and inputs ("less predictable and more varied results") | same |
| `suno/suno-v5.5-relay` (also v5, v4.5+, v4.5 relay) | `inspire-mode`, `custom-mode`, `cover-mode`, `inpainting`, `extend`, `clip`, `upload`; an unlisted `generate-lyrics` path is in the OpenAPI file with no price card | $0.10 per request; `clip` and `upload` $0.002 |

- Output (`SunoOutput`): `title`, `lyrics`, `clips[]`; each `MusicClip` has `task_id`, `clip_id`, `title`, `audio_url`, `image_url`, `duration`, `styles`, `lyrics`. **`duration` is an output field only. There is no length input** on either v6 endpoint, and no language, tempo, key, seed or reference-audio input.
- How many clips one request returns is not stated in the schema and there are no examples.
- Relay description: "Suno officially retired versions before v6. This legacy v5.5 slug remains available for API compatibility and is now served by Suno v6; endpoint names and prices are unchanged." "Relay" is not defined anywhere.
- Relay inputs: `extend` {`task_id`, `clip_id`, `continue_at` (seconds), `title`, `lyrics`, `style`, `instrumental`}; `clip` {`task_id`, `clip_id`, `crop_start`, `crop_end`}; `inpainting` {`clip_id`, `title`, `lyrics`, `aligned_lyrics`, `style`, `infill_start`, `infill_end`, `infill_dur` 10–30, `song_duration`}; `cover-mode` {`clip_id`, `title`, `lyrics`, `style`}; `upload` {`url`}. Whether these accept a clip made on the v6 slug is not stated.
- `metadata` on all six Suno entries is `{"show_price_on_homepage": false}`: no `commercial_use`, no `official_partner`. The catalogue sets `commercial_use: true` on 155 of 259 models and never `false`; the field is not documented.
- Account lane (CLI / MCP tool `create_audio`): models `suno-v6`, `suno-v6-wild`; arguments for music are `prompt` and `force_instrumental` only (no lyrics, style, title, Max Mode, extend or crop). Free quote: 10 credits per request.

## 2. Sunra's own terms

Terms of Use, "Last updated: November 17, 2026" (sunra.ai/terms-of-use). An older Terms of Service ("Last Updated: 18 March 2026") is still linked from the API site's footer and is narrower.

- Outputs: "Sunra does not claim ownership of the content the Service generates for you ("Outputs"). As between you and Sunra, to the extent Sunra has any rights in your Outputs, they belong to you." [V]
- Commercial use: "You may use Outputs for any lawful purpose, including commercial purposes, subject to these Terms and the law." [V] Enterprise FAQ: "Yes. What you make is yours to use for any lawful purpose, including ads, campaigns, films and client work." [V]
- Building a product on the API: "You may build the Sunra API into your own apps, products, platforms and services, including ones your customers use to make content, and offer them commercially." [V] "You must not resell or sublicense access to the Sunra API itself, or your keys, on a stand-alone basis, for example as a pass-through API without your own product around it." [V]
- Creative account (plan credits, MCP, CLI): outputs may be used "commercially and at volume, including for client delivery" [V], but you may not "build or run an app, website, bot, platform or service that lets other people create content through your Sunra Creative account" [V]; software integrations must use the API.
- Other companies' models: "The Service gives you access to AI models built by other companies… Their own terms may also apply to your use of them." [V] Acceptable use: you must not "break the usage policies of the model you use, where those are stricter than these Terms." [V] No list says which upstream terms apply; the sub-processor page names neither Suno nor ElevenLabs.
- No promise on uniqueness or copyright: "we cannot promise that Outputs are unique or that they are protected by copyright where you live." [V]
- Warranty and indemnity: "we disclaim all warranties, including merchantability, fitness for a particular purpose and non-infringement." [V] The customer defends Sunra for claims "arising from your Inputs, your use of Outputs, products you build on the Sunra API and how their users use them" [V]. Liability cap: "the greater of USD 100 or the amount you paid Sunra in the 12 months before the claim arose." [V]
- Data: "No training. Sunra does not use your Inputs or Outputs to train AI models." [V] Content is kept "Until you delete it or close your account". How long output URLs live is not stated.
- Models may change: Sunra "may add, change or remove features or models… We will give reasonable notice of changes that materially reduce what you have paid for." [V] The effect on rights in earlier outputs is not stated.
- Music prompts (help page): "Music naming an artist, track or lyrics — describe the style and mood instead." [V]
- Not found anywhere on Sunra's pages: any statement of a Suno or ElevenLabs licence, partnership or authorisation.

## 3. Suno's terms and official pages

Terms of Service, "Effective Date: September 3, 2026" (suno.com/terms).

- Paid plans: "Suno hereby assigns to you all of its right, title and interest in and to any Output owned by Suno and generated from Submissions made by you through the Service" [V]. Free plan: "you will only use such Outputs for your lawful, personal and non-commercial purposes" [V].
- Condition: "You may not commercially exploit Output that has not been downloaded by you through an approved channel under these Terms of Service." [V] "Approved channel" is not defined; the only gloss is "Obtaining a copy of an Output by any means other than a download channel made available by Suno is prohibited (for example, recording or stream ripping are prohibited)." [V] The Terms never mention an API or partners.
- Survival: the assignment and commercial rights in a download "are perpetual and are not affected by … the expiry, cancellation, downgrade or suspension of your subscription" [V].
- No attribution required (help article). Suno takes no share: "without Suno claiming a stake in the earnings" [V].
- Marks and rights holders: "We reserve the right to append a fingerprint, watermark, or metadata indicating the applicable service tier of an Output and whether such Output was a permitted Download." [V] "Applicable rights holders may also have the right to collect revenue related to distribution of Outputs on third party platforms." [V] (who and when is not stated). Downloads from Suno carry AI-generated metadata: "When a song is downloaded from Suno, we attach metadata identifying it as AI-generated content made with Suno." [V]
- Restrictions: not to "sell, resell, grant access to, transfer, or otherwise use or exploit any portion of the Service, and any Output or Voice Model, for any commercial purposes" except as permitted [V]; no "data mining, robots, scraping" [V]; "If you are an enterprise user, you must contact sales to use our Service" [V].
- No indemnity for users; the user indemnifies Suno [V]. "Suno makes no representation or warranty to you that any copyright will vest in any Output." [V]
- API status: `platform.suno.com` says "Generate original songs, covers, and mashups from a single prompt — Suno's music generation engine behind a simple REST API." [V] It is sign-in gated; no public API terms or partner list were found. Suno names no aggregator.
- Training data for v6: partnerships with Warner Music Group (2025-11-25), BMG (2026-08-12) and Believe (2026-09-08) announced on Suno's blog [V]. Trade press (secondary): UMG and Sony have not settled and filed a second suit on 2026-09-18 that targets v6.
- Capabilities (Suno help): "All three variants support up to 8 minutes per generation." [V] "Each time you generate, you make two songs with a total cost of 10 credits." [V] Max Mode "costs more credits" and is described as best for songs over two minutes and consistent vocals [V]. Artist names: "when a prompt references a specific artist, we remove the artist's name and redirect the request toward descriptive musical characteristics" [V]. No official list of lyric languages was found.

## 4. Known and not written, in one place

- Written: Sunra lets API customers use outputs commercially and build customer-facing products; Suno assigns paid-tier output to the user with perpetual commercial rights in downloads and no attribution; v6 is trained with licensed catalogues from three partners.
- Not written: under which agreement Sunra serves Suno; whether output obtained through an API provider counts as downloaded "through an approved channel"; what `commercial_use` means and why it is absent on these entries; who the "applicable rights holders" are and when they may collect; whether files delivered through Sunra carry Suno's watermark or metadata; any indemnity from either company; what a model's withdrawal does to earlier outputs.
- A written answer from Sunra on those points would close the record. A draft of that question is in `docs/BRAND-SOUND-STUDIO.md`, appendix A.
