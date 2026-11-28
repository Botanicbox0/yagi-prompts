/**
 * MiniMax Music 3.0 (`minimax/minimax-music3/text-to-music`, through Sunra's API lane): the music Prompt Architect
 * profile for Sound Studio v2, built strictly from `PROMPTING-RESEARCH.md` §0–§1, §4–§5 (2026-11-28).
 *
 * Every rule carries its support level from `PROMPTING-RESEARCH.md`:
 *   [official] · [practitioner-consistent] · [single-source] · [our-measurement]
 *
 * Sunra's `text-to-music` endpoint matches the open-weights deployment (`duration` 1..75 s, 44.1 kHz WAV, `prompt`
 * <= 2,000 chars, `lyrics` <= 3,500 chars, `is_instrumental` boolean; no title input on the endpoint).
 */
import type { ProfileHeader } from '../meta';

/**
 * Open-weights MiniMax Music 3.0 documented section tags (`PROMPTING-RESEARCH.md` §1, lines 30–31) [official]:
 * each tag must stand alone on its own line (`[Tag]`) with zero inline text on that line.
 */
export const MINIMAX_OPEN_WEIGHTS_TAGS = [
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Post-Chorus',
  'Bridge',
  'Instrumental',
  'Solo',
  'Outro',
] as const;

export const MINIMAX_MUSIC_3_HEADER: ProfileHeader = {
  id: 'minimax-music-3',
  version: '2026-11-28.1',
  models: ['minimax-music-3'],
  sources: [
    {
      url: 'https://github.com/MiniMax-AI/MiniMax-Music3',
      seen: '2026-11-28',
      claim: 'English Structured Caption with three headings in order (Global Metadata, Vocal Details, Arrangement); 9 open-weights section tags ([Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus] [Bridge] [Instrumental] [Solo] [Outro]); section musical instructions belong in Arrangement; duration is an upper bound [official]',
    },
    {
      url: 'https://github.com/MiniMax-AI/MiniMax-Music3/blob/main/skills/music-caption-rewriter/SKILL.md',
      seen: '2026-11-28',
      claim: 'do not invent a precise key, BPM, or vocal gender unless stated or strongly supported; instrumental Vocal Details states Instrumental + lead melodic instrument; concrete musical changes in Arrangement; never quote or paraphrase lyrics in prompt; preserve explicit exclusions; lead with genre, groove, instrumentation over generic adjectives [official]',
    },
    {
      url: 'https://fal.ai/models/minimax/music-3/api',
      seen: '2026-11-28',
      claim: 'one tag per line (text on the same line as a tag is dropped); lead with genre; explicit exclusions ("no drums") unlock sparse arrangements; 44.1 kHz 16-bit WAV, duration <= 75 s [official]',
    },
    {
      url: 'https://help.scenario.com/en/articles/1574698333',
      seen: '2026-11-28',
      claim: 'name non-English vocal language explicitly in the prompt (e.g. "in Korean") and put only sung words in lyrics [single-source]',
    },
    {
      url: 'docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt',
      seen: '2026-11-28',
      claim: 'Sunra minimax/minimax-music3/text-to-music caps prompt at 2,000 chars and lyrics at 3,500 chars with duration 1..75 s and copyright moderation on artist/track names [official]',
    },
  ],
  lastVerified: '2026-11-28',
};

/**
 * System instruction for MiniMax Music 3.0 (`minimax/minimax-music3/text-to-music`).
 * The text model answers JSON (`style` = the `TextToMusicInput.prompt` caption, `title` = list name, `notes` = 1 sentence).
 *
 * Rule support levels (`PROMPTING-RESEARCH.md` §1):
 * - [official] English Structured Caption with three headings in exact order: `Global Metadata:`, `Vocal Details:`, `Arrangement:`.
 * - [official] Sized under Sunra's 2,000-character ceiling: aim for 400 to 1,750 characters (~90 to 270 English words; minimum 200 characters, hard cap 2,000).
 * - [official] `Global Metadata:` genre/subgenre, groove/meter, tempo feel (NO invented BPM or musical key unless the request or attached reading explicitly states it), emotional progression, and commercial production profile. Lead with specific genre, groove, and instrumentation rather than generic adjectives (`emotional`, `epic`, `dark`, `modern`).
 * - [official] + [single-source] Exclusions ("no drums", "without synth pads") ARE kept in the caption when asked for.
 * - [official] + [single-source] `Vocal Details:` for vocals, describe timbre, register, delivery, placement, and restrained backing/harmonies; include vocal gender (`male`/`female`) ONLY if the request or reading states it; explicitly include `"in Korean"` when singing in Korean (or name the sung language). For instrumentals, write `"Instrumental;"` and name the lead melodic instrument — never describe a singer or voice.
 * - [official] `Arrangement:` section-by-section timeline of concrete musical changes (what enters, exits, shifts, or intensifies in each section, matching any lyric tags in order); section directions go here, never on lyric tag lines; never quote or paraphrase lyrics in the caption.
 * - [official] Never write a duration in seconds or minutes in the caption (`duration` is sent separately), never name a real artist, band, song, album, producer or label, and keep the caption in English (Hangul allowed only inside double quotes for an explicit brand or product name from the request).
 */
export const MINIMAX_MUSIC_3_PROFILE = `Model: MiniMax Music 3.0, a song and music generator for commercial advertising and brand videos. It reads a structured English caption (\`style\`) and, for vocal songs, separate tagged lyrics.

Write \`style\` in English as a Structured Caption of 450 to 1,750 characters (at least 220 characters and strictly under 1,800 characters; hard limit 2,000), using these exact three headings on separate lines in this exact order:

Global Metadata: <text>
Vocal Details: <text>
Arrangement: <text>

Rules for each heading:
1. Global Metadata: Lead with the specific genre and subgenre, time feel and groove, tempo feel word (such as unhurried, steady mid-tempo, upbeat, driving), emotional progression, and clean commercial production profile. Prefer concrete genre, groove, and instrumentation over vague adjectives (emotional, epic, dark, modern). When the customer asks to exclude an element (for example "no drums" or "드럼 없이"), state that exclusion explicitly here or in Arrangement (for example "no drums").
2. STRICT precision rule (Global Metadata & Vocal Details): NEVER invent a numeric BPM (such as "120 BPM"), a musical key (such as "C major" or "A minor"), or a vocal gender ("male", "female", "man", "woman") unless the customer's request or an attached reference reading explicitly states it. When BPM is not given, use tempo feel words only. When vocal gender is not given, describe vocal timbre, register, and delivery without naming a gender.
3. Vocal Details:
   - When vocals are enabled: describe lead timbre, register, placement, delivery, and restrained harmonies or backing; include vocal gender ONLY if explicitly supported by the request or reading; always state the sung language explicitly (write "singing in Korean" — including the exact phrase "in Korean" — whenever the vocals are in Korean, or "singing in English" for English).
   - When instrumental (vocals disabled): start with "Instrumental;" and name the lead melodic instrument that carries the theme (for example "Instrumental; a warm felt piano carries the main melody."). Never mention a singer, vocalist, singing, or harmonies.
4. Arrangement: Write a section-by-section timeline of concrete musical changes — what instruments enter, exit, answer, build, or stop in each section (for example "Intro: ... Verse: ... Chorus: ... Outro: ..." for vocal tracks, matching the song's sections in order, or "Opening: ... Middle: ... Ending: ..." for instrumentals). Put all section-specific musical directions here in Arrangement. Never quote, translate, or paraphrase the sung lyric lines inside the caption.

Hard bans across the caption:
- Write the caption in English only. Never include Hangul characters anywhere in \`style\` except inside double quotes for an exact brand or product name given by the customer's request (and only when needed).
- Never write a length in seconds or minutes (such as "30 seconds", "30s", "30-second", "1 minute"): output length is passed in a separate parameter.
- Never name a real singer, band, group, song, album, producer, or record label: translate any style direction into genre, groove, era production traits, and instrumentation.
- Never mention engine, service, or API terms.

Title: a short name for the track (at most 40 characters) in the language of the lyrics, or of the customer's request when there are none, for the customer's track list. Name the track itself; do not copy the request's opening words, and never use a superlative or claim (best, No.1, 최고, 1위).

Notes: one plain sentence in the customer's language saying what sound you designed (genre, instruments, feel). Describe the sound only: never repeat superlatives or claims.`;
