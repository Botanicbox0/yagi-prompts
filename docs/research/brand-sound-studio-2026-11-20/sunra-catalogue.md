# Sound studio design — Sunra catalogue facts (read 2026-11-20, free calls only)

Source: `GET https://api.sunra.ai/v1/models?limit=300` (259 models, no key), `GET /v1/pricing/model/{id}/endpoint/{name}`, each model's `openapi` schema, `sunra tools`, `sunra call list_models {"type":"audio"}`, `sunra call estimate_cost` (free). No paid call made.

## Music on the API lane (`api.sunra.ai`)
| alias | endpoints | list price | inputs | output | `metadata.commercial_use` |
| --- | --- | --- | --- | --- | --- |
| `suno/suno-v6` | inspire-mode, custom-mode | $0.10 / request; custom-mode $0.20 with `max_mode` | inspire: `prompt` ≤3000, `instrumental`; custom: `title` ≤80, `lyrics` ≤5000, `style` ≤1000, `instrumental`, `max_mode`. **No duration input** | `clips[]` {clip_id, audio_url, duration, lyrics} (how many clips per request: not stated) | **absent** |
| `suno/suno-v6-wild` | same | same | same | same | absent |
| `suno/suno-v5.5-relay` (also v5, v4.5+, v4.5 relay slugs; "now served by Suno v6") | inspire, custom, cover-mode, inpainting (10–30 s section), extend (`continue_at`), clip (crop, $0.002), upload ($0.002) | $0.10 / request | as named | same | absent |
| `minimax/minimax-music3` | text-to-music | **$0.16 / song, fixed, up to 75 s** | `prompt` ≤2000, `lyrics` ≤3500 (structure tags), `duration` 1–75 (default 60, "may end earlier"), `is_instrumental`, seed, steps, guidance | WAV 44.1 kHz 16-bit stereo + actual seconds | **true** |
| `bytedance/voice-separation` | audio-separation | $0.01 / minute of input | audio or video URL | two stems: vocals + accompaniment (aac/mp3/wav/m4a/flac) | absent |
| `elevenlabs/music-v1, v2, v2.5` | text-to-music | — | — | — | ruled out by the founder (2026-11-18) |

`commercial_use: true` is set on 155 of 259 catalogue models and never `false`; it is absent on the Suno entries. Sunra's docs file (`docs.sunra.ai/llms-full.txt`) has no licence / ownership wording for Suno.

## Music on the account lane (CLI / `mcp.sunra.ai`, tool `create_audio`)
`list_models type=audio`: `suno-v6`, `suno-v6-wild`, plus the ruled-out vendor's music / SFX / TTS and other TTS. `estimate_cost {type:"audio", model:"suno-v6"}` → **10 credits** (= $0.10). MiniMax Music 3.0 is **not** on the account lane. Concurrency 20 (shared).

## Sound effects
The only text-to-sound-effects model in the catalogue is the ruled-out vendor's (`elevenlabs/sound-effects`). `bytedance/seed-audio-1.0` (text-to-audio, $0.1875/min, commercial_use true) reads as speech with voices; SFX use not confirmed. Video models with native audio exist (Seedance 2.5, Kling v4, HeyGen Video 1, Gemini Omni) but are video generators.
