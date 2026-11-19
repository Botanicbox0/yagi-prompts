# Sound studio design — music / SFX by API (web, all read 2026-11-20)

[V] = string-matched on the fetched page. [WF] = extracted by the fetch tool, not string-matched; re-check before relying on it. The vendor the founder ruled out on 2026-11-18 is left out.

| Vendor / model | Official API | List price | Length / features | Terms that matter |
| --- | --- | --- | --- | --- |
| Stability Stable Audio 3.0 (Large by API) / 2.5 | Yes (platform.stability.ai) | 8 credits = $0.08 per generation, up to 6 min (3.0) / 3 min (2.5) [V] | text-to-audio, audio-to-audio, inpaint, 44.1 kHz stereo; 2.5 "less than two seconds on a GPU, for tracks up to three minutes" [V]; no vocal mode (unverified) | "trained on fully licensed data" [V]; "we assign to you all of our right, title, and interest (if any) in the Outputs" [V]; "you may permit your end users to access and use functionality enabled by the Services solely through your own product or service, as an integrated component" [V]; indemnity only under the Enterprise licence [V]; must not remove watermark / provenance [V] |
| Google Lyria 3.5 / 3 Pro (Gemini API, Vertex Pre-GA) | Yes | $0.08 per song; 30 s clip model $0.04; Lyria 2 $0.06 per 32.8 s [V] | up to 184 s; vocals + lyrics incl. Korean, instrumental mode [V]; single turn, no extend / inpaint / stems / reference audio [WF] | "Google does not assert any ownership rights in any new intellectual property created in the Generated Output." [V]; output indemnity list does not name Lyria [WF]; SynthID watermark on all audio [WF]; refuses artist-voice and copyrighted-lyrics prompts [WF]; no use "to develop a similar or competing product or service" [V] |
| Mureka 9.5 | Yes (platform.mureka.ai) | own price page 확인 못 함; on fal $0.15 per song with lyrics or instrumental, $0.50 prompt-only [V] | song, instrumental, extend, region edit, stems, soundtrack from video; Korean [V] | FAQ: "All content generated through paid API calls comes with full usage rights and commercial authorization … advertisements, videos" [V]; ToS, sublicensing, training data: 확인 못 함 |
| MiniMax Music 3.0 | Vendor API closed to new users since 2026-08-20 [V]; still on Sunra and fal | vendor legacy $0.15 per track up to 5 min; Sunra $0.16 per song up to 75 s; fal $0.002/s | lyrics, instrumental, cover | terms 확인 못 함 |
| Suno v6 | **No official public API** (curated partner beta) [WF] | Sunra lists it at $0.10 per request | — | Terms (2026-09-03) [WF]: "You may not commercially exploit Output that has not been downloaded by you through an approved channel."; no automation. A catalogue listing does not change these terms. |
| Udio | No API; downloads disabled after the label deals (secondary) | — | — | — |
| Beatoven | Yes, price not public | — | music + SFX | licensed-data claim, on the Fairly Trained list [WF] |
| Soundraw | Yes | about $0.30 a song at 1,000 songs / $300 a month [WF] | — | in-house training material; "Let users make their own music" [WF] |
| Loudly, Mubert | Yes | not public / $49–499 a month | — | royalty-free licence claims; indemnity undefined |
| fal (aggregator) | — | `ace-step` $0.0002/s, `stable-audio-3/medium` $0.0376, `lyria3/pro` $0.08, `minimax/music-3` $0.002/s | — | terms [WF]: "for your own personal or internal business use"; "Client will not expose any of the Services APIs directly to any End Users."; no IP indemnity. Not a production path. |

## Sound effects (excluding the ruled-out vendor)
- Stable Audio 3.0 Small SFX: Stability terms as above; $0.08 direct.
- MMAudio weights CC BY-NC [WF]; ThinkSound "Commercial use is NOT permitted." [V]; HunyuanVideo-Foley licence excludes South Korea [V]. None usable.
- Kling video-to-audio $0.035 a call, commercial terms 확인 못 함. Mirelo SFX 2.0 $0.015/s via fal, paid use commercial [V]. Beatoven SFX licensed-data claim, price not public.

## Quality signal
Artificial Analysis Music Arena (page undated, [WF]): instrumental — Suno v6 1148, Mureka 9.5 1084, Lyria 3 Pro 1080, Stable Audio 3 Large 1014; vocals — ACE Music v1 1160, Suno v6 1144, Mureka 9.5 1101, Lyria 3.5 1050. The open ACE-Step 1.5 weights are not on the board; "ACE Music v1" (the same company's hosted product) was not researched.
