/**
 * Suno v6 (music, through Sunra's API lane): the music Prompt Architect's rules (docs/BRAND-SOUND-STUDIO.md §12.1,
 * §12.2). Suno documents almost nothing about prompting, so every rule carries its evidence level and the ones
 * marked "needs our check" in §12.1 stay out until our own output proves them (the image Architect's way).
 *
 * The engine has five inputs: describe mode `prompt` + `instrumental`; custom mode `title`, `style`, `lyrics`,
 * `instrumental`, `max_mode`. No length, language, tempo, key, negative-prompt or seed input.
 */
import type { ProfileHeader } from './meta';

export const SUNO_HEADER: ProfileHeader = {
  id: 'suno',
  version: '2026-11-21.1',
  models: ['suno-v6'],
  sources: [
    {
      url: 'https://suno.com/blog/building-the-future-of-music-responsibly',
      seen: '2026-11-20',
      claim: 'no prompts for specific artists or copyrighted songs; names are removed and redirected to musical characteristics [official]',
    },
    {
      url: 'https://help.suno.com/en/articles/2462273',
      seen: '2026-11-20',
      claim: 'describe genre, mood, instruments and vocal in the style; "More direction creates better songs" [official]',
    },
    {
      url: 'https://suno.com/music-library/use-cases/advertising',
      seen: '2026-11-20',
      claim: 'a "15 seconds max" ad brief came back at 39 s: a length written in the prompt is not kept [official, observed]',
    },
    {
      url: 'https://help.suno.com/en/articles/9010177',
      seen: '2026-11-20',
      claim: 'Max Mode helps songs over two minutes and vocal consistency; not needed for short ad music [official]',
    },
    {
      url: 'https://github.com/mttkllr/suno-field-guide',
      seen: '2026-11-20',
      claim: 'English style paragraph, one sentence per instrument and what it does; order genre, tempo, voice, instruments, structure, mix, ending; BPM as a number with a feel word; describe the sound you want instead of "no X" [practitioner]',
    },
    {
      url: 'https://popularaitools.ai/blog/suno-v6-intro-ending-prompts-2026',
      seen: '2026-11-20',
      claim: 'write the ending (how the song stops); without it v6 repeats the chorus to a fade [practitioner]',
    },
    {
      url: 'docs/research/brand-sound-studio-2026-11-20/sung-confirmation.md',
      seen: '2026-11-21',
      claim: 'an instrumental request with section marks in the lyrics is refused ("lyrics must be empty when instrumental is true"); instrumentals came back at 142-190 s; sung Korean ran 0.7-2.8 syllables a second by tempo; two songs of one request differed in length by up to 2.5x [house]',
    },
    {
      url: 'docs/research/brand-sound-studio-2026-11-20/suno-via-sunra.md',
      seen: '2026-11-20',
      claim: 'field limits: style 1,000, lyrics 5,000, title 80, prompt 3,000; a vocal track without lyrics sang in the language the style named (two of two, Korean) [aggregator, house]',
    },
  ],
  lastVerified: '2026-11-21',
};

/**
 * The system instruction for designing what goes to Suno. The model answers JSON (lib/brand-studio/sound/architect.ts):
 * `style` (one English paragraph), `title`, `notes` (one sentence in the customer's language).
 */
export const SUNO_PROFILE = `Model: a song and music generator for short brand advertising and social videos. It reads one English style paragraph and, when given, lyrics.

Write the style as ONE paragraph of plain English, 400 to 900 characters, in this order:
1. Genre and feel in a few words.
2. Tempo as a number with a feel word ("around 92 BPM, relaxed"). It is only approximate.
3. The voice: gender, register and delivery, and the language it sings in when there are vocals; or "instrumental" and what carries the melody when there are none.
4. Two or three instruments, one short sentence each on what that instrument does.
5. Structure in a phrase (a short intro, where the hook lands, the build).
6. Mix and space in a phrase (warm and close, airy, punchy low end).

Never write a length in seconds or minutes, mixing console values, or a pile of adjectives. Never name a real singer, band, song, album, producer or label: describe the era and the musical traits instead. No brand names other than one the request itself gives, and never in the style.

Title: a short title (at most 40 characters) in the language of the lyrics, or of the customer's request when there are none.

Notes: one plain sentence in the customer's language saying what you designed (genre, voice, feel), for the customer to read.`;
// [official] no artist or song names (Suno blog); more direction is better (help); a written length is not kept (Suno's own
// ad example: "15 seconds max" came back at 39 s); Max Mode is for long songs. [practitioner] English paragraph, one sentence per
// instrument, order, BPM with a feel word. [aggregator] field limits (Sunra schema).
// [house] the language named in the style is the language sung (smoke test 2026-11-20, two of two).
// [house] from the sung confirmation (§12.8, 2026-11-20, 42 songs): no lyrics at all for an instrumental (the engine refuses even
// section marks), and its length (142–190 s) is fitted only by the length tool; sung Korean runs about 1.6 syllables a second at
// 110 BPM and above, 1.2 at 90–110, 0.9 below 90, so the lyrics amount sets only a rough range (one request's two songs
// differed up to 2.5x). These shape the lyrics engine (../../sound/lyrics.ts), not this paragraph.
// Applied because §12.2 asks for it, still to be proved by ear (§12.6 a): the 400–900 character paragraph against short keywords.
// Held out until the founder's listening result (§12.8, §8-11): how it ends (b), Latin vs Hangul brand names (e), positive
// wording against "no X" (f). See CHANGELOG 2026-11-21.1.
