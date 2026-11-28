# Music Prompt Architect profiles — changelog (`profiles/music/`)

Every rule change bumps `version` in the profile's header, adds an entry here with its support level from
`PROMPTING-RESEARCH.md` (`[official]`, `[practitioner-consistent]`, `[single-source]`, `[our-measurement]`), and
runs `npx tsx --conditions=react-server scripts/sound-architect-eval.ts --dry-validate` (plus `--v2 --out <path>` when approved for live text evaluation).

## minimax-music-3 2026-11-28.2 (B3 fix round 1 — research alignment & precision)

- **Consistent caption length numbers** (`[official]`, `PROMPTING-RESEARCH.md:36` + Sunra OpenAPI): unifies profile and task wording on `200..2000` characters, aiming for `450..1800`.
- **BPM ranges vs exact BPM** (`[official]`, `PROMPTING-RESEARCH.md:26`): clarifies that an exact single BPM is allowed only when stated in the request or a high-confidence reading (within `±3`), whereas an unstated tempo may use tempo feel words or a BPM range (`90-100 BPM`).
- **Non-English language rule only** (`[single-source]`, `PROMPTING-RESEARCH.md:39`): removes the extra `"singing in English"` instruction; requires naming non-English vocal languages explicitly (`"in Korean"` when Korean).
- **Vocal gender & instrumental harmonies** (`[official]`, `PROMPTING-RESEARCH.md:26-27`): expands banned unstated gender words to include `feminine`, `masculine`, `lady`, `guy`, and gendered singer pronouns (`she`, `he`, `her`, `his`); narrows the instrumental harmony ban to `vocal harmonies` so instrumental string/brass harmonies remain valid.
- **Lyric tags matched in `Arrangement:`** (`[official]`, `PROMPTING-RESEARCH.md:28`): requires naming every section tag used in the lyrics in `Arrangement:` in order.

## suno-v6 2026-11-28.1 (Sound Studio v2 per-model profile)

- Moves `SUNO_PROFILE` wording rules unchanged into `suno-v6.ts` (`SUNO_V6_PROFILE`), re-exported byte-for-byte by
  `../suno.ts` so the closed v1 path (`suno@2026-11-21.2`) and v2 `suno-v6` send the exact same system text.
- Labels every rule with its research support level (`[official]`, `[practitioner-consistent]`, `[single-source]`,
  `[our-measurement]`). Held-out rules (`ending`, `"no X"`, brand script) remain held out until founder listening confirmation.

## suno-v6-wild 2026-11-28.1 (Sound Studio v2 per-model profile)

- Uses the exact same `system` wording as `suno-v6` (`SUNO_V6_WILD_PROFILE === SUNO_V6_PROFILE`): `PROMPTING-RESEARCH.md` §3
  found no official or practitioner basis for writing Wild prompts differently (`[practitioner-consistent]`).
- Adds `SUNO_V6_WILD_NOTE` documenting that Wild pushes further from the prompt (`help.suno.com/en/articles/13924801`
  `[official]`), so section structure, tempo, and planned length are followed less reliably (`[single-source]` / inferred).

## minimax-music-3 2026-11-28.1 (Sound Studio v2 per-model profile, new)

- New profile for `minimax/minimax-music3/text-to-music` (open-weights deployment via Sunra):
  - **Structured Caption** (`[official]`, MiniMax-Music3 README + `music-caption-rewriter/SKILL.md`): English caption of
    `200..2000` characters (aim `< 1,800`) with three headings in exact order: `Global Metadata:`, `Vocal Details:`,
    `Arrangement:`.
  - **No fabricated precision** (`[official]`, `SKILL.md`): numeric BPM, musical key, and vocal gender (`male`/`female`)
    are forbidden unless stated in the customer's request or an attached reference reading.
  - **Exclusions kept** (`[official]` + `[single-source]`, `SKILL.md` + fal): explicit exclusions such as `"no drums"`
    are preserved in the caption.
  - **Vocals vs instrumental** (`[official]` + `[single-source]`, `SKILL.md` + Scenario): vocal tracks name the sung
    language (`"in Korean"` when Korean); instrumental tracks state `"Instrumental;"` plus the lead melodic instrument
    and omit singer descriptions and lyrics.
  - **Arrangement & bare lyric tags** (`[official]`, README + fal + Sunra OpenAPI): section-by-section musical changes
    live in `Arrangement:`; lyrics are never quoted in the caption; lyric tag lines must be bare `[Tag]` on their own
    line from the 9-tag open-weights allow-list (`[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Post-Chorus]`,
    `[Bridge]`, `[Instrumental]`, `[Solo]`, `[Outro]`), `<= 3,500` characters, sized for `duration` (`1..75` s).
