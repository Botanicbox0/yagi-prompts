# Helvetica Neue webfont assets

The project owner confirmed that they own the license and authorized webfont use
for TWINGS on 2026-09-20. These fonts remain proprietary; this note does not grant
a new font license and the repository's other font licenses do not apply to them.

| WOFF2 file | Owner-supplied source | Weight |
|---|---|---|
| `helvetica-neue-roman.woff2` | `HelveticaNeueRoman.otf` / Helvetica Neue Roman | 400 |
| `helvetica-neue-medium.woff2` | `HelveticaNeueMedium.otf` / Helvetica Neue Medium | 500 |
| `helvetica-neue-bold.woff2` | `HelveticaNeueBold.otf` / Helvetica Neue Bold | 700 |

WOFF2 conversion uses fontTools. Family/name records, glyph order, character map,
and CFF outlines are preserved and checked against the source files. These faces
contain no Hangul; Korean is rendered with the separately licensed, existing
Pretendard Variable assets. The CSS maps Latin ranges to Helvetica Neue and does
not rely on fonts installed on a visitor's computer.
