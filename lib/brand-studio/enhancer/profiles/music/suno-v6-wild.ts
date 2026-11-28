/**
 * Suno v6 Wild (`suno/suno-v6-wild`, through Sunra's API lane): the music Prompt Architect profile for Sound Studio v2.
 *
 * Research (`PROMPTING-RESEARCH.md` §3, 2026-11-28) found NO official or practitioner evidence for writing a different
 * style prompt for Wild; practitioner guides explicitly recommend keeping wording identical to Suno v6 so model choice
 * isolates Wild's exploratory decoding. This profile therefore re-exports `SUNO_V6_PROFILE` unchanged (zero invented
 * "be bolder" rules) and differs ONLY in its `ProfileHeader` (`id: 'suno-v6-wild'`, `models: ['suno-v6-wild']`) and
 * one informational note (`SUNO_V6_WILD_NOTE`).
 */
import type { ProfileHeader } from '../meta';
import { SUNO_V6_HEADER, SUNO_V6_PROFILE } from './suno-v6';

export const SUNO_V6_WILD_HEADER: ProfileHeader = {
  id: 'suno-v6-wild',
  version: '2026-11-28.1',
  models: ['suno-v6-wild'],
  sources: [
    {
      url: 'https://help.suno.com/en/articles/13924801',
      seen: '2026-11-28',
      claim: 'Wild leans into unexpected choices, genre-blending, and results that push further from the prompt; same inputs, limits, 2 clips and 8-minute ceiling as v6 [official]',
    },
    {
      url: 'https://suno.com/blog/introducing-v6',
      seen: '2026-11-28',
      claim: 'Wild is built for exploration — less predictable and more varied than v6 [official]',
    },
    {
      url: 'https://jackrighteous.com/en-gb/blogs/guides-using-suno-ai-music-creation/where-to-put-your-suno-prompt-guide',
      seen: '2026-11-28',
      claim: 'keep prompt wording identical when comparing v6 and v6 Wild; no separate style-writing syntax exists for Wild [practitioner-consistent]',
    },
    ...SUNO_V6_HEADER.sources,
  ],
  lastVerified: '2026-11-28',
};

/**
 * Informational note on Wild's model behaviour (`PROMPTING-RESEARCH.md` §3, lines 76 & 80):
 * - [official] Wild pushes further from the prompt (`help.suno.com/en/articles/13924801`).
 * - [single-source] / inferred: strict section tags, exact BPM, and bar-based length plans are followed less reliably than on v6.
 */
export const SUNO_V6_WILD_NOTE =
  'Suno v6 Wild pushes further from the prompt than v6, so section structure, approximate tempo and planned length are followed less reliably.';

/**
 * Exact same wording rules as `SUNO_V6_PROFILE` (`SUNO_V6_WILD_PROFILE === SUNO_V6_PROFILE`).
 * Support levels match `suno-v6.ts` ([official], [practitioner-consistent], [single-source], [our-measurement]).
 */
export const SUNO_V6_WILD_PROFILE: string = SUNO_V6_PROFILE;
