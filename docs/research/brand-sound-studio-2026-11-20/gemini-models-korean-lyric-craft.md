# Gemini text models (prices, limits) and the craft of sung Korean lyrics (read 2026-11-20)

**[V]** string-matched on the fetched page; **[WF]** reported by a summarising tool; "확인 못 함" no primary source opened.

## 1. Gemini Developer API models usable for lyric writing

Sources [V]: ai.google.dev/gemini-api/docs/models, /thinking, /pricing, /deprecations. The key's own model list (`GET /v1beta/models`, read 2026-11-20) includes all five Gemini 4 / 3.8 ids below.

| API id | Released | Default thinking; levels | USD per 1M input / output (output includes thinking) | Scheduled change |
| --- | --- | --- | --- | --- |
| `gemini-4-carbon` | 2026-11-10 | medium; low–high | 2.00 / 10.00 | 4.00 / 20.00 from 2026-12-01 |
| `gemini-4-argon` | 2026-10-13 | medium; low–high | 2.00 / 10.00 | 4.00 / 20.00 from 2026-12-01 |
| `gemini-4-neon` | 2026-11-18 | high; low–xhigh | 3.00 / 15.00 | none |
| `gemini-4-hydrogen` | 2026-11-12 | high; low–xhigh | 1.50 / 7.50 | none |
| `gemini-3.8-flash` | 2026-09-02 | medium; low–high | 0.75 / 3.75 | 1.50 / 7.50 from 2027-01-01 |

- Thinking cannot be switched off on Gemini 4 or 3.8 Flash; the lowest level is `low`. The docs warn that `xhigh` "can cause overthinking or exhaust `max_output_tokens`" on simple text or JSON prompts [V].
- Paid tier: "Content not used" to improve products; free tier content is used and may be read by reviewers [V]. The studio uses the paid tier.
- Public preference boards [WF]: LMArena Creative Writing (2026-11-20) Argon 2nd (1,520), Carbon 4th (1,515), Neon 5th (1,502), Hydrogen 9th (1,491), 3.8 Flash 11th (1,489). LMArena Korean: Argon 3rd (1,487), 3.8 Flash 15th (1,461); the other three are outside the top 15. That board measures Korean chat preference, not writing. No public leaderboard for Korean creative writing or lyrics was found.

## 2. Sung Korean lyrics: rules a writer can follow and a reviewer can check

Sources opened [V]: GQ Korea "한글과 멜로디" (2014, quoting a vocal trainer and the book 《작사노트》); an interview with the lyric team 당케 (2024-03-15); interviews with lyricist 김이나 (W Korea 2020, 텐아시아 2015); miso.kr lesson posts (author unnamed, low authority); an interview with an agency creative director on song ads (비즈워치 2019-07-11); a marketing article on CM songs (고구마팜 2023).

Taught by two or more sources:
1. Count syllables against the melody: one syllable per note unless the melody slurs.
2. Parallel lines (verse 1 and 2, repeated hook lines) keep the same syllable count.
3. Put the key word on the stressed or long note; cut modifiers before cutting the key word.
4. Long notes, high notes and ad-lib spots take open syllables: no 받침, or a 받침 that links onto the next syllable.
5. Avoid stacked 받침 in fast or high passages.
6. Hard 받침 and tense or plosive sounds are a deliberate choice for percussive beats or an aggressive voice.
7. Avoid plosive-heavy words in ballads.
8. Sing the draft aloud and replace any word that catches.
9. The hook is one short sentence that survives repetition.
10. English sits in the hook and ad-libs.
11. Korean words next to English should be 받침-free so they blend.

One source each:
12. Where syllables come fast, choose words that slide.
13. Verse = scene, pre-chorus = turn, chorus = conclusion.
14. A line with an emotion name but no action reads as cliché; narrow it to who, where and what happens.
15. A song ad carries one very simple message.
16. A jingle is a short melody with one lyric phrase; "CM송" means roughly 30 seconds or more.

No Korean source found (hypotheses for a reviewer, used as working assumptions in our test prompt):
17. Hook line of about 3–7 syllables; a sung 15-second spot holds roughly 20–30 syllables and a 30-second spot 45–60.
18. Brand name in the hook and on the final long note, two or three times in 15 seconds.
19. Do not split a word or a noun + particle unit across a rest.
20. Write spoken register; drop particles where speech drops them; avoid translated-sounding phrases.
21. One speech level per song.
22. Clichés to flag: 별빛, 운명, 영원히, 꿈을 향해, 날개를 펴고, 함께라면, 특별한 하루, 빛나는 내일, 새로운 시작.

Advertising wording: the broadcast advertising review rules bar "객관적으로 인정받지 못하거나 확인할 수 없는 최상급의 표현" [V, 2008 text; current wording not confirmed]. A known case: a delivery-and-lodging brand's song changed "최저가" to "초특가" for this reason (interview above) [V]. 표시광고법 and the FTC notice were not opened (확인 못 함). Working rule for lyrics: no 최고, 최초, 유일, 1위 and no efficacy claims without evidence the brand supplies.
