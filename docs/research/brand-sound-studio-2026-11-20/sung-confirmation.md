# Sung confirmation for the music Prompt Architect — record (2026-11-20)

Founder-approved paid step (he typed "진행해" in the session). 22 requests on the Sunra API lane, `suno/suno-v6`, all without Max Mode. Charged **US$2.10** (`billing.amount`; quote $2.20, hard stop $2.60). 21 requests returned two clips each (42 files); one was rejected by input validation and not charged.

Model names are not in this file. The lyric-writer letters are those of `lyrics-blind-sheet.md`; the key is `lyrics-blind-key.md`. The founder's listening sheet is `sung-listening-sheet.md`.

Measured with ffprobe (length), ffmpeg `volumedetect` (mean level of the body and of the last second) and, as a weak aid, faster-whisper small on CPU. The transcription tool cannot judge sung Korean reliably, so nothing here ranks pronunciation or lyric writers.

| request | endpoint | sung lines | Hangul syllables | seconds to result | clip lengths (s) | syllables per second | last second vs body (dB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lyrics-jingle-ko-C | custom-mode | 1 | 23 | 35 | 17.0 / 12.8 | 1.35 / 1.80 | -2.2 / -2.3 |
| lyrics-jingle-ko-B | custom-mode | 3 | 25 | 36 | 22.8 / 12.8 | 1.10 / 1.95 | -7.1 / -7.7 |
| lyrics-jingle-ko-A | custom-mode | 4 | 31 | 63 | 18.0 / 16.5 | 1.72 / 1.88 | -10.2 / -3.5 |
| lyrics-launch-ko-B | custom-mode | 6 | 61 | 33 | 36.0 / 28.4 | 1.69 / 2.15 | -1.6 / -24.7 |
| lyrics-launch-ko-C | custom-mode | 8 | 52 | 28 | 25.9 / 18.8 | 2.01 / 2.77 | -1.4 / -22.8 |
| lyrics-launch-ko-A | custom-mode | 8 | 50 | 62 | 35.6 / 37.5 | 1.40 / 1.33 | 1.6 / -2.5 |
| lyrics-brandfilm-ko-A | custom-mode | 13 | 124 | 65 | 110.0 / 136.4 | 1.13 / 0.91 | -24.5 / -26.7 |
| lyrics-brandfilm-ko-C | custom-mode | 13 | 93 | 55 | 104.2 / 128.0 | 0.89 / 0.73 | -13.3 / -28.1 |
| lyrics-brandfilm-ko-D | custom-mode | 12 | 100 | 88 | 127.6 / 96.0 | 0.78 / 1.04 | -35.6 / -12.6 |
| rule-a-1-customer-words | inspire-mode | — | — | 65 | 169.8 / 141.6 | — | -67.9 / -43.5 |
| rule-a-2-designed-paragraph | inspire-mode | — | — | 92 | 190.0 / 144.1 | — | -50.6 / -15.9 |
| rule-b-1-no-ending-written | custom-mode | 4 | 43 | 60 | 52.8 / 57.8 | 0.81 / 0.74 | -16.9 / -24.1 |
| rule-b-2-ending-written | custom-mode | 5 | 53 | 65 | 62.4 / 46.8 | 0.85 / 1.13 | -17.9 / -11.7 |
| rule-c-1-four-lines | custom-mode | 4 | 30 | 33 | 38.2 / 37.4 | 0.79 / 0.80 | -10.8 / -14.0 |
| rule-c-2-eight-lines | custom-mode | 8 | 63 | 55 | 50.8 / 35.2 | 1.24 / 1.79 | -4.1 / -3.5 |
| rule-d-2-instrumental-section-labels | custom-mode | — | — | 17 | rejected: invalid_input | — | — |
| rule-c-3-fourteen-lines | custom-mode | 14 | 114 | 49 | 40.7 / 100.0 | 2.80 / 1.14 | -3.0 / -13.5 |
| rule-e-1-brand-latin | custom-mode | 3 | 18 | 38 | 27.4 / 18.4 | 0.66 / 0.98 | -5.2 / -15.8 |
| rule-d-1-instrumental-described | inspire-mode | — | — | 81 | 184.8 / 184.8 | — | -56.2 / -46.5 |
| rule-e-2-brand-hangul | custom-mode | 3 | 24 | 71 | 19.5 / 19.2 | 1.23 / 1.25 | -0.6 / -4.8 |
| rule-f-1-negative-wording | inspire-mode | — | — | 45 | 57.0 / 54.8 | — | -5.3 / -13.2 |
| rule-f-2-positive-wording | inspire-mode | — | — | 78 | 61.1 / 123.2 | — | -6.0 / -13.1 |

## What the measurements settle

- **Instrumental requests cannot carry lyrics.** The custom-mode request with `instrumental: true` and a lyrics field holding only section labels was rejected: "lyrics must be empty when instrumental is true". Section labels cannot be used to shape or shorten an instrumental on this path.
- **Instrumentals come long**: 141.6–190.0 s here (203–232 s in the smoke test), whatever the wording.
- **Lyric amount sets the neighbourhood, not the length.** Same style, 4 lines: 38.2 and 37.4 s; 8 lines: 50.8 and 35.2 s; 14 lines: 40.7 and 100.0 s. The two clips of one request can differ by a factor of 2.5, and more lines are sometimes simply sung faster.
- **Singing rate depends on tempo.** Across the 34 vocal clips the rate was 0.66–2.80 Hangul syllables per second: about 1.1–2.8 at 112–118 BPM, 0.8–2.8 at 100 BPM, 0.7–1.1 at 78 BPM. The 60-second ballad brief (93–124 syllables) came back at 96–136 s, about twice the target; the 15-second jingle (23–31 syllables) at 12.8–22.8 s; the 30-second launch (50–61 syllables) at 18.8–37.5 s.
- **Endings.** In the ending pair (four lines, with and without `[Outro]` / `[End]`) all four clips ended with the level falling 12–24 dB in the last second; this pair shows no measurable difference. About half of the short clips (jingle, launch) hold their level to the end, which may be the "clean stop" the style asked for or a cut: listening decides.
- **Customer words vs designed paragraph** (describe mode, instrumental): lengths 141.6–190.0 s on both sides, all ending in a fade. Quality is for listening.
- **Brand spelling, negative vs positive wording, lyric writers**: not decidable with these tools. The transcriber found no voice in several vocal clips and "heard" stock phrases in others.
- Every file carries the `made with suno; …` comment tag.
