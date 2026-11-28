# Music Prompt Architect profiles — changelog (`profiles/music/`)

Every rule change bumps `version` in the profile's header, adds an entry here with its support level from
`PROMPTING-RESEARCH.md` (`[official]`, `[practitioner-consistent]`, `[single-source]`, `[our-measurement]`), and
runs `npx tsx scripts/sound-architect-eval.ts --dry-validate` (plus `--v2 --out <path>` when approved for live text evaluation).

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
