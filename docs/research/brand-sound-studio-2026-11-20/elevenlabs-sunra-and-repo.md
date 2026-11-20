# ElevenLabs music / sound effects — what Sunra lists and what the repo already has (read 2026-11-20)

Free, read-only calls only: Sunra public catalogue and price endpoints, each model's `openapi` schema, `sunra call estimate_cost` (free quote), and the repo at `origin/main` `b188b85d`. No generation.

## Sunra catalogue (API lane, `api.sunra.ai`)

| alias | list price | notes from the schema |
| --- | --- | --- |
| `elevenlabs/music-v2.5` ("the newest Eleven Music model") | **$0.60 per minute of output, billed per started minute** | `prompt` or `composition_plan` (not both); `music_length_ms` 3,000–600,000 (3 s–10 min), optional; `force_instrumental` ("guarantees that the generated song will be instrumental", prompt mode only); `seed` (plan mode only, "exact reproducibility is not guaranteed"); 25 output formats, default `mp3_48000_192`, PCM up to 48 kHz. Plan = up to 30 `chunks`, each 3–120 s with `text` (section name, lyric lines, inline directions), `positive_styles`, `negative_styles`, `context_adherence`, `audio_reference` (a clip of at most 30 s with a `strength`). |
| `elevenlabs/music-v2` | $0.60 per started minute | same input shape as v2.5 |
| `elevenlabs/music-v1` | $0.80 per started minute | older plan shape: `positive_global_styles`, `negative_global_styles`, `sections[]` (`section_name`, `positive_local_styles`, `negative_local_styles`, `duration_ms`, `lines`), `respect_sections_durations` |
| `elevenlabs/sound-effects` ("Eleven Text to Sound v2") | **$0.002 per second** | `text` ≤ 450 chars, `duration` 0.5–22 s (auto when omitted), `prompt_influence` 0–1 (default 0.3), 19 output formats, default `mp3_44100_128` |

- Length note in the schema: "Billing is per started minute of the actual output; because the model renders a few tens of milliseconds more than requested, a length on or within 500ms below a whole minute (e.g. 60000) is sent as that minute minus 500ms (59500) so the result stays inside the minute you asked for." So a "60 s" request returns about 59.5 s and bills one minute.
- The v1 schema says of `seed`: "Honored on the elevenlabs_official channel only; ignored on fal." Sunra therefore serves this vendor through more than one upstream channel, one of them another aggregator. Which channel a given call uses is not stated.
- `metadata.commercial_use` is **absent** on all four entries (it is `true` on 155 of 259 catalogue models, including this vendor's speech models `eleven-v3` / `eleven-v4`).
- Sunra's docs file has no wording on output rights for these models.

Cost per track on the API lane (v2.5): 30 s $0.60, 60 s $0.60 (59.5 s), 180 s $1.80. Sound effect: 5 s $0.01, 10 s $0.02, 22 s $0.044.

## Sunra account lane (CLI / MCP, tool `create_audio`)

Free quotes (`estimate_cost`, 1 credit = $0.01): `elevenlabs-music` 30 s → 80 credits, 60 s → 80, 180 s → 240 (so $0.80 per started minute; which music version the account lane runs is not stated). `elevenlabs-sound-effects` 5 s → 1 credit, 10 s → 2, 22 s → 5. Arguments: `music_length_ms` 3,000–600,000 (default 30,000), `force_instrumental`, `duration_seconds` 0.5–22 (default 5). No composition plan argument on the account lane tool.

## What the repo already has for this vendor

- `lib/brand-studio/music/provider.ts`
  - `sunra_elevenlabs` (lines 480–554): submits `elevenlabs/music-v2.5/text-to-music` through `SUNRA_API_KEY` / `SUNRA_BASE_URL` with `music_length_ms` clamped to 3–59.5 s, `force_instrumental: true`, `output_format: 'mp3_44100_128'`; marks the result `commercialAllowed: true`, `licenseSource: 'commercial_licensed'`, certificate ref `STUDIO-COMMERCIAL-AUDIO-API`. No document in the repo backs that label.
  - Its composition-plan branch sends the **v1** plan shape (`positive_global_styles`, `sections[]`) to the **v2.5** endpoint, whose plan is `chunks[]`. That branch would be rejected upstream (not run to confirm: it would be a paid call).
  - `elevenlabs` (lines 413–478): a direct adapter with `ELEVENLABS_API_KEY` / `ELEVENLABS_API_URL`, but its default URL is the vendor's **sound-generation** (sound effect) endpoint, not the music API; capped at 22 s, no polling. It is not a music integration.
  - Provider order (`resolveMusicProviderId`, lines 94–105): explicit `BRAND_STUDIO_MUSIC_PROVIDER`, then a Suno URL + key, then `SUNRA_API_KEY` → `sunra_elevenlabs`, then `ELEVENLABS_API_KEY`, then the production bridge, then fake, then local YuE2. With today's production env (Sunra key present) opening the flag would route music to this vendor through Sunra.
- `lib/brand-studio/music/service.ts`: closed behind `BRAND_STUDIO_MUSIC_GENERATION`; flat credits `12 + ceil(seconds / 5) × 2` (30 s = 24 credits = 240 KRW) against a provider cost of $0.60 (about 840 KRW at the repo's 1,400 rate) for the same track; records a fake `video_final` row, stores the file as an asset only.
- `lib/brand-studio/music/sfx.ts`: **open** (no flag; only the `sound` feature group). Submits `elevenlabs/sound-effects/text-to-sound-effects` through Sunra with `text`, `duration_seconds`, `prompt_influence`; flat credits `4 + ceil(seconds / 5) × 2` (5 s = 6 credits); always labelled commercial.
- `lib/legal/documents.ts` (privacy notice, processor table): Sunra's operator is listed as the processor for brand-studio image, video and sound-effect generation, with this vendor named among the relayed models.
- Env names read by the code: `SUNRA_API_KEY`, `SUNRA_BASE_URL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_API_URL`, `BRAND_STUDIO_MUSIC_PROVIDER`, `BRAND_STUDIO_MUSIC_GENERATION`. `.env.example` has none of the vendor-specific names. Whether a vendor key exists in the deployment was not checked (names only would have meant reading production settings).

## Reuse for a Sound Studio

Reusable as is: the Sunra client (`createSunraClient`), the request fields for prompt mode (`music_length_ms`, `force_instrumental`, `output_format`), the SFX request, the fake provider and synth for local runs, the asset storage helper. To change: the plan shape for v2.5, the 59.5 s clamp (the model goes to 10 min), the job record (real `music` kind and `audio` output, as in the design doc §6.2), the credit basis, and the unbacked "commercial" labels.
