/**
 * Suno v6 (`suno/suno-v6`, through Sunra's API lane): the music Prompt Architect profile for Sound Studio v2.
 *
 * Wording rules are TODAY'S `SUNO_PROFILE` byte-for-byte (`../suno.ts` re-exports `SUNO_V6_PROFILE` as `SUNO_PROFILE`
 * so the closed v1 path and v2 `suno-v6` send the exact same system instruction text). Every rule below carries its
 * support level from `PROMPTING-RESEARCH.md` (2026-11-28) and `docs/research/brand-sound-studio-2026-11-20/`:
 *   [official] · [practitioner-consistent] · [single-source] · [our-measurement]
 */
import type { ProfileHeader } from '../meta';

export const SUNO_V6_HEADER: ProfileHeader = {
  id: 'suno-v6',
  version: '2026-11-28.1',
  models: ['suno-v6'],
  sources: [
    {
      url: 'https://suno.com/blog/building-the-future-of-music-responsibly',
      seen: '2026-11-20',
      claim: 'no prompts for specific artists or copyrighted songs; names are removed and redirected to musical characteristics [official]',
    },
    {
      url: 'https://suno.com/blog/introducing-v6',
      seen: '2026-11-28',
      claim: 'v6 is reliable and precise for a fixed brief; understands vocals, instrumentation, structure and mood [official]',
    },
    {
      url: 'https://help.suno.com/en/articles/2462273',
      seen: '2026-11-20',
      claim: 'describe genre, mood, instruments and vocal in the style; Inspire mode takes natural descriptions while Suno writes lyrics [official]',
    },
    {
      url: 'https://suno.com/music-library/use-cases/advertising',
      seen: '2026-11-20',
      claim: 'a "15 seconds max" ad brief came back at 39 s: a length written in the prompt is not enforced [official]',
    },
    {
      url: 'https://help.suno.com/en/articles/9010177',
      seen: '2026-11-20',
      claim: 'Max Mode helps songs over two minutes and vocal consistency; not needed for short ad music [official]',
    },
    {
      url: 'https://undetectr.com/blog/suno-v6-prompts',
      seen: '2026-11-28',
      claim: 'describe each instrument by what it does; English producer paragraph (~700-900 chars); vocal placement and performance verbs; bracket tags are hints [practitioner-consistent]',
    },
    {
      url: 'https://github.com/mttkllr/suno-field-guide',
      seen: '2026-11-20',
      claim: 'English style paragraph, one sentence per instrument and role; order genre, tempo (BPM + feel word), voice, instruments, structure, mix [practitioner-consistent]',
    },
    {
      url: 'https://popularaitools.ai/blog/suno-v6-intro-ending-prompts-2026',
      seen: '2026-11-20',
      claim: 'without an ending cue v6 repeats the chorus; held out until founder listening confirmation [single-source]',
    },
    {
      url: 'docs/research/brand-sound-studio-2026-11-20/sung-confirmation.md',
      seen: '2026-11-21',
      claim: 'instrumental=true rejects any lyrics including bare tags; instrumentals run 142-232 s; vocal without lyrics sings in the language named in style; length follows sung lines and bars (length-plan.ts), two clips differ up to 2.5x [our-measurement]',
    },
  ],
  lastVerified: '2026-11-28',
};

/**
 * System instruction for Suno v6 (`suno/suno-v6`). Byte-identical to `SUNO_PROFILE` in `../suno.ts` (`2026-11-21.2`).
 *
 * Rule support levels (`PROMPTING-RESEARCH.md` §2):
 * - [official] Never name a real singer, band, song, album, producer or label; describe era and musical traits.
 * - [official] Never write a length in seconds or minutes (Suno has no duration text control; Suno's own 15 s ad ran 39 s).
 * - [official] Describe genre, tempo/feel, vocals or lead melodic instrument, instruments, structure, and mix.
 * - [practitioner-consistent] One plain-English paragraph, 400 to 900 characters (hard cap 1,000), one short sentence per instrument on what it does, approximate BPM with a feel word, mix/space phrase, no console values or adjective piles.
 * - [our-measurement] Name the sung language in the voice sentence when vocals have no written lyrics (2/2 Korean confirmation); for instrumentals, name the melody instrument and send empty lyrics (`length-plan.ts` governs bar length).
 * - [single-source] Ending / "no X" / Latin-vs-Hangul brand rules remain held out per `suno 2026-11-21.1` until founder listening confirmation.
 */
export const SUNO_V6_PROFILE = `Model: a song and music generator for short brand advertising and social videos. It reads one English style paragraph and, when given, lyrics.

Write the style as ONE paragraph of plain English, 400 to 900 characters, in this order:
1. Genre and feel in a few words.
2. Tempo as a number with a feel word ("around 92 BPM, relaxed"). It is only approximate.
3. The voice: gender, register and delivery, and the language it sings in when there are vocals; or "instrumental" and what carries the melody when there are none.
4. Two or three instruments, one short sentence each on what that instrument does.
5. Structure in a phrase (a short intro, where the hook lands, the build).
6. Mix and space in a phrase (warm and close, airy, punchy low end).

Never write a length in seconds or minutes, mixing console values, or a pile of adjectives. Never name a real singer, band, song, album, producer or label: describe the era and the musical traits instead. No brand names other than one the request itself gives, and never in the style.

Title: a short name for the track (at most 40 characters) in the language of the lyrics, or of the customer's request when there are none. It is the track's name in the customer's list: name the track, do not copy the request's first words, and never use a superlative or a claim (best, No.1, 최고, 1위).

Notes: one plain sentence in the customer's language saying what you designed (genre, voice, feel), for the customer to read. Describe the sound only: never repeat the request's claims or superlatives.`;
