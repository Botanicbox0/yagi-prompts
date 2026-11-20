# How Suno v6 wants to be prompted — evidence by level (read 2026-11-20)

Purpose: source material for the music profile of the Prompt Architect (`docs/BRAND-SOUND-STUDIO.md` §12). Our API (Sunra) has five inputs only: describe mode `prompt` + `instrumental`; custom mode `title`, `style`, `lyrics`, `instrumental`, `max_mode`. No length, language, BPM, key, negative-prompt or seed input.

Labels: **[official]** Suno's own pages. **[practitioner]** guides and community sources with broad agreement. **[folklore]** single-source or contested. **[V]** string-matched on the fetched page; **[WF]** reported by a summarising fetch (help.suno.com is script-rendered, so none of its text could be string-matched). "확인 못 함" where no evidence was found.

Suno's own documentation says little about prompting: no tag command language, no pronunciation setting, no lyrics-to-seconds rule. Most of what follows is practitioner knowledge and must be settled by our own tests.

## 1. Fields
- Describe mode [official, WF]: one description; you can "mash up genres and specify instrumentation and song structure"; vocal gender in words. help.suno.com/en/articles/2462273, /10153473
- Custom mode [official]: Style, Lyrics, Title. Suno publishes no character limits (확인 못 함). Relay docs [practitioner, unofficial]: style 1000, lyrics 5000, title 80, describe prompt 3000 for v4.5–v6, matching our API. docs.sunoapi.org/suno-api/generate-music
- Sentences or tags: "More direction creates better songs." [official, V] suno.com/v6. Practitioners for v6: write a "producer's brief, not a tag cloud", one sentence per instrument saying what it does, 700–900 characters (pastebin.com/RK06uiKL, undetectr.com/blog/suno-v6-prompts). Contrary [folklore, one Korean post]: 4–5 short English keywords beat sentences (dpg.danawa.com/board/ai/6083484).
- Order [practitioner, unproven]: genre → pulse and key → voice → instruments → arrangement → mix → ending.
- Variety and Exclude Styles are app controls [official, V] with no input on our API. Practitioner consensus: writing "no humming" in the style adds the word; state the wanted sound positively. Contrary [folklore]: a trailing `no drums` works (github.com/mttkllr/suno-field-guide).

## 2. Style descriptors
- Suno's Music Glossary [official, WF] lists tempo terms with BPM ranges, key and mode, time signature, vocal techniques, mix terms. help.suno.com/en/articles/9010177
- BPM is approximate [practitioner]; add meter and groove words. Key "usually respected" [one report].
- Voice: gender plus descriptors "help guide" the output [official, WF]; practitioners use performance verbs.
- Weak or ignored [practitioner]: console values (dB, sidechain settings), slider words typed as text, adjective piles.
- Words that invite choirs [practitioner, v6]: "anthemic", "arena", "stacked harmonies", "call and response" (jackrighteous.com … stop-suno-adding-crowd-vocals…).
- Language named in the style [practitioner]: "female vocals singing in Korean" (hookgenius.app/learn/suno-korean-prompts).

## 3. Tags inside lyrics
- No official tag list. The glossary only says "Mix structural terms to guide song form" [WF]. A reviewed guide (Oct 2026) notes Suno "does not define [End], [Soft End] or [Dramatic End] as guaranteed control commands" (jackrighteous.com … suno-ai-end-prompt-guide).
- Section tags [practitioner consensus, "still occasionally ignored"]: `[Intro] [Verse 1] [Pre-Chorus] [Chorus] [Bridge] [Break] [Interlude] [Instrumental] [Solo] [Final Chorus] [Outro] [Fade Out]`. `[Hook]` is not a synonym for `[Chorus]` (pastebin.com/ZFsx2ZAt).
- Square brackets are instructions; parentheses are sung (backing vocals, echoes, ad-libs) [practitioner consensus]. Instructions in parentheses get sung.
- Formatting effects [practitioner, mostly single reports]: ALL CAPS emphasis; ellipsis hesitation; a line break is a phrase boundary; `lo-o-ove` holds a note but may be spelled out; `[Pause]` collapses to about a second.

## 4. Ending and length
- "up to 8 minutes" per generation [official, WF]; nothing official on what sets length. A Duration slider exists in the web app for v5.5 [official, V release notes 2026-07-20]; relays expose `duration`; our API does not.
- Lyrics-to-seconds: 확인 못 함. "There is no reliable universal words-to-seconds formula." (jackrighteous.com … suno-duration-slider-song-length-guide)
- A length written in the style is not enforced: on Suno's own advertising library a track styled "STRICT MAXIMUM LENGTH: 15 SECONDS" runs 0:39 [V] (suno.com/music-library/use-cases/advertising).
- Ending [practitioner, v6]: with no ending instruction v6 repeats the chorus until the length runs out; give the ending a shape; keep the last section to four lines or fewer (popularaitools.ai/blog/suno-v6-intro-ending-prompts-2026). `[End]` alone "around 85–90% effective" [folklore, v5.5].
- Short cuts [practitioner]: one idea, short lines, hook first, no verses or long intro; then trim outside Suno.
- Max Mode [official, V]: "an optional higher-credit setting for longer songs, covers, style transfers and more consistent vocals"; the FAQ recommends it above two minutes. It does not help jingles.
- Our smoke test (2026-11-20): six lyric lines gave 22 s and 44 s; four lines with Max Mode 61 s and 46 s; vocal without lyrics about 70 s; instrumentals 203–232 s.

## 5. Instrumental
- Use the flag; even so v5.5 "occasionally bleeds in subtle vocal textures — humming, breathy tones" [practitioner] (apipass.dev/blogs/12-suno-v5-v5-5-hacks). Name what plays; avoid choir and anthem words.
- Whether a tags-only lyrics field is honoured when `instrumental` is true: 확인 못 함 (guides disagree). To test.

## 6. Korean
- Nothing official on language or pronunciation; no pronunciation setting.
- [practitioner]: "Always use Hangul… never romanized Korean"; transliterate only a failing word.
- [folklore, one Korean post]: lines of 10–15 characters with similar length; Latin abbreviations written by sound (OK → 오케이); a comma near 겹받침 words.
- Numbers as words [practitioner, English evidence]. Latin brand names vs Hangul spelling and 연음: 확인 못 함; test both spellings per brand.
- One language per section while testing [practitioner].

## 7. Refusals and silent changes
- "we remove the artist's name and redirect the request toward descriptive musical characteristics" [official, V]; "we've never allowed prompts for specific artists or copyrighted songs" [official, V] (suno.com/blog/building-the-future-of-music-responsibly).
- Blocked before generation [official, WF]: well-known artists or people, "copyrighted or trademarked terms", derogatory terms, "excessive profanity" (help.suno.com/en/articles/3198209).
- Screening [official, V]: "Audible Magic, Musixmatch and other third party technology providers to screen uploaded audio files and lyrics"; checks "block content that may be similar to existing recordings and lyrics" (suno.com/safety).
- Accounts [official, V]: "We restrict, in appropriate circumstances, the accounts of users who repeatedly infringe" (suno.com/community-guidelines).
- App messages [practitioner]: "Prompt Contained Inappropriate Material"; "Your lyrics contain copyrighted material". The trigger word is not named.
- Relay APIs [unofficial]: status `SENSITIVE_WORD_ERROR`; no separate artist or lyric code documented. Sunra's docs: moderation category `copyright` ("The provider reported copyright restrictions, real-person content, sensitive content…") and a help line "Music naming an artist, track or lyrics — describe the style and mood instead."
- Brand names in lyrics: trademark terms are on the official block list with no detail: 확인 못 함. To test with invented names first.

## 8. Reference audio in the Suno app (not on our API)
- Audio upload (60 s free, up to 8 min paid; "copyrighted works will be blocked from audio upload" [official, V 2024]), Covers ("only… for songs you created" [WF]), Voices (own voice only, verification), Personas, Inspire, Mashup, Sample, stems [official release notes]. Unofficial relays list Upload-and-Cover, Upload-and-Extend, Persona, stem separation.
- On Sunra (catalogue, 2026-11-20): `suno/suno-v6` has `inspire-mode` and `custom-mode` only: no audio input. The legacy `suno/suno-v5.5-relay` slug has `cover-mode` (takes a Suno `clip_id`), `upload` (a URL "for use in extend or concat operations"), `extend`, `clip`, `inpainting`. In our smoke test `extend` and `clip` failed on a v6 clip; `upload` and `cover-mode` were not tried. No persona or voice input anywhere.

## 9. Ad and jingle craft [practitioner]
- 4–8 lines, brand name at least once and in the hook, simple rhyme; sonic logo 3–5 s, social 5–15 s, radio 15/30 s (hookgenius.app/learn/ai-jingle-generator-guide).
- Brand pronunciation (English evidence): respell by sound, identical every time; digits as words.
- Suno Sounds (one-shots and loops with BPM and key) is a separate app mode, not on our API.
