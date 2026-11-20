# ElevenLabs music and sound-effects API — capabilities, price, quality evidence (all pages read 2026-11-20)

**[V]** = string-matched on the fetched page. **[WF]** = reported by a summarising tool. Docs base: `elevenlabs.io/docs/`. Licence terms are in `elevenlabs-terms.md`; what Sunra lists and what the repo has are in `elevenlabs-sunra-and-repo.md`.

## Music API

Models: `music_v1` (deprecated, removed 2027-01-31, still the API default, so `model_id` must be set), `music_v2`, `music_v2_5` [V `api-reference/music/compose`, `overview/capabilities/music`].

| Topic | Finding |
| --- | --- |
| Length | `music_length_ms` "between 3000ms and 600000ms", prompt mode only [V]. Plan chunks `duration_ms` 3,000–120,000, up to 30 chunks, total 3 s–10 min [V]. The capability page and the API pricing card say 5 minutes maximum [V] (conflict). Exact output length is not promised in prompt mode; for v2 / v2.5 plans "section durations are always enforced" [V]. |
| Instrumental, vocals | `force_instrumental` (prompt mode only) [V]. Lyrics in chunk `text` (v2) or `lines` (v1), max 30 lines × 200 chars. Styles must be English, "lyrics can be any language" [V]. Named languages: English, Spanish, German, Japanese "and more". Korean: 확인 못 함. |
| Composition plan | v1: `positive_global_styles`, `negative_global_styles`, `sections[]`. v2 / v2.5: `chunks[]` with `text`, `duration_ms`, `positive_styles`, `negative_styles`, `context_adherence`, a conditioning reference and strength. `POST /v1/music/plan` "does not cost any credits but is subject to rate limiting depending on your tier" [V]. |
| Editing | Inpainting: `store_for_inpainting` or `POST /v1/music/upload`, then mix kept audio-reference chunks with regenerated or extended chunks [V]. Conditioning reference at most 30 s. Finetunes (`finetune_id`, $1.50 each [V]). `POST /v1/music/video-to-music` with `add_sfx`, `separate_tracks`, `use_audio_as_reference` [V]. |
| Stems, loops, tempo, key, seed | `POST /v1/music/stem-separation`, `two_stems_v1` or `six_stems_v1` [V openapi]. No loop, BPM or key parameter for music; prompt only ("accurately follows BPM and often captures the intended musical key") [V]. `seed` plan mode only, "exact reproducibility is not guaranteed" [V]. |
| Formats | mp3 up to 48 kHz 320 kbps, PCM 8–48 kHz, Opus, μ-law / A-law [V]. Plan gates stated on some endpoints: 192 kbps needs Creator+, 44.1 kHz PCM needs Pro+ [V]. |
| Latency | No official figure; only "in seconds" [V blog]. Streaming endpoints exist (`/v1/music/stream`) [V]. |
| Concurrency | Music: Starter 2, Creator 2, Pro 2, Scale 5, Business 5, Enterprise "Highest". Sound effects: 4, 4, 6, 6, 8, 8, "Elevated" [V `overview/models`]. |
| Provenance | `sign_with_c2pa` (mp3 only) [V]. |
| Artist names | A band or musician name, or copyrighted lyrics, returns `bad_prompt` with `prompt_suggestion`; plans return `bad_composition_plan` with a suggested plan [V]. |

## Sound-effects API (`POST /v1/sound-generation`)

- Models: `eleven_text_to_sound_v2` (default, deprecated, removed 2027-03-01) and `eleven_text_to_sound_v3` (all workspaces since the 2026-11-02 changelog) [V].
- `duration_seconds` "at least 0.5 and at most 30", `prompt_influence` 0–1 (default 0.3), `loop` (bool) [V]. "WAV at 48 kHz for non-looping effects" [V].
- Latency: no figure published. Video to sound effects only through `video-to-music` with `add_sfx`.

## Price

Plans [V `elevenlabs.io/pricing`, `/pricing/api`]:

| | Starter | Creator | Pro | Scale | Business |
| --- | --- | --- | --- | --- | --- |
| USD / month | 6 | 22 | 99 | 299 | 990 |
| API music minutes included | 40 | 147 | 660 | 1,993 | 6,600 |
| API music $ / minute | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 |
| Sound-effect generations included | 150 | 605 | 3,000 | 9,000 | 30,000 |

- "API usage is billed in US dollars, not credits… Eleven Music $0.15 per minute… Sound Effects $0.12 per minute"; "Music and Sound Effects are billed per generation" [V]. Enterprise is custom. Top-ups are prepaid and service pauses at $0 [V].
- Music through the API at $0.15 / minute: 30 s $0.075, 60 s $0.15, 180 s $0.45 (assumes per-second proration, which the page does not state).
- Sound effects have two official readings that disagree: (a) $0.12 / minute = $0.002 / s → 5 s $0.01, 10 s $0.02; (b) credits, "200 credits per generation" at auto duration and "40 credits per second" when a duration is set [V] → 5 s about $0.033–0.04, 10 s about $0.066–0.08 on Creator to Scale. One metered call would settle it.
- Stems in the app: "0.5× generation cost for 2 stems and 1× generation cost for 4 stems" [V]; the API price is 확인 못 함. Plan creation is free [V]. Upload for inpainting costs the same as generation [V].
- Who may subscribe to which plan is a licence matter (individual-only up to Pro; Scale under 10 employees; Business under 50): see `elevenlabs-terms.md`.

Aggregators: fal `elevenlabs/music/v2.5` "$0.6 per output audio minute… rounded up to the closest minute" [V], sound effects "$0.002 per seconds" [V]; Replicate `elevenlabs/music` "$8.30 per thousand seconds of output audio" [V]. Sunra's list price equals fal's.

## Quality evidence

Artificial Analysis Music Arena: blind pairwise Elo from "validated private evaluators" [V methodology page]. The pages show no date; embedded entries run to 2026-11-11.

- Instrumental (±21) [V]: 1 Suno v6 1148, 2 Suno v6-mini 1114, 3 Mureka V9.5 1084, 4 Mureka V9 1083, 5 Lyria 3 Pro 1080, 6 Lyria 3.5 1078, **7 Eleven Music v1 1021**, 8 Stable Audio 3 Large 1014, **9 Eleven Music v2 1011**, 10 MiniMax 2.5+ 1007, **11 Eleven Music v2.5 1001**, 14 Stable Audio 3 Medium 996, 19 MusicGen 868.
- Vocals (±18) [V]: 1 ACE Music v1 (ACE Studio) 1160, 2 Suno v6 1144, 3 Suno v6-mini 1132, 4 Mureka V9.5 1101, 5 Mureka V9 1063, 6 Lyria 3.5 1050, 7 Lyria 3 Pro 1048, **8 Eleven Music v2.5 1016**, **9 Eleven Music v2 1002**, 10 MiniMax 3.0 1000, **11 Eleven Music v1 998**.
- The open ACE-Step 1.5 (XL) weights are not on either board under that name; whether "ACE Music v1" is those weights is 확인 못 함.
- Sound effects: no blind benchmark found.
