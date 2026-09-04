/**
 * YAGI WORKSHOP wordmark — constructed, not typeset.
 *
 * Every letter is drawn from straight strokes and circular arcs of ONE stroke weight, in a
 * 100-unit cap height. Diagonal strokes overshoot the cap box and are clipped flat at the cap
 * line and baseline (the geometric-sans construction); round letters overshoot by 1 unit so they
 * read optically the same height. No JSX here: `scripts/export-wordmark.ts` runs this file under
 * plain Node to write the static brand SVGs, and `Wordmark.tsx` animates the same strokes.
 */
export const CAP = 100;
export const STROKE = 16;
export const CREAM = '#E8E4DC';

const OV = 14; // diagonal overshoot beyond the cap box, clipped flat

export interface Glyph {
  /** visual width (right edge of the ink) */
  adv: number;
  /** stroke centrelines */
  paths: string[];
  /** clip to the cap box: letters with diagonals */
  clip?: boolean;
}

// prettier-ignore
export const GLYPHS: Record<string, Glyph> = {
  Y: { adv: 92,  clip: true, paths: [`M 8 ${-OV} L 46 52 L 84 ${-OV}`, 'M 46 52 L 46 100'] },
  A: { adv: 96,  clip: true, paths: [`M 6 ${CAP + OV} L 48 ${-OV} L 90 ${CAP + OV}`, 'M 20 68 L 76 68'] },
  G: { adv: 101, paths: ['M 77.65 14.78 A 43 43 0 1 0 93 50', 'M 50 50 L 101 50'] },
  I: { adv: 16,  paths: ['M 8 100 L 8 0'] },
  W: { adv: 136, clip: true, paths: [`M 6 ${-OV} L 34 ${CAP + OV} L 68 ${-OV} L 102 ${CAP + OV} L 130 ${-OV}`] },
  O: { adv: 101, paths: ['M 50 7 A 43 43 0 1 1 50 93 A 43 43 0 1 1 50 7'] },
  R: { adv: 84,  clip: true, paths: ['M 8 100 L 8 0', 'M 8 8 L 48 8 A 22 22 0 0 1 48 52 L 8 52', `M 44 52 L 84 ${CAP + OV}`] },
  K: { adv: 86,  clip: true, paths: ['M 8 100 L 8 0', `M 8 54 L 80 ${-OV}`, `M 8 54 L 86 ${CAP + OV}`] },
  S: { adv: 70,  paths: ['M 59.47 20.13 A 27 21 0 1 0 35 50 A 27 21 0 1 1 10.53 79.87'] },
  H: { adv: 86,  paths: ['M 8 100 L 8 0', 'M 78 100 L 78 0', 'M 8 52 L 78 52'] },
  P: { adv: 78,  paths: ['M 8 100 L 8 0', 'M 8 8 L 46 8 A 24 24 0 0 1 46 56 L 8 56'] },
};

export const GAP = 20; // between letters
export const SPACE = 44; // the word space, on top of two gaps
/** Optical kerning: diagonals leaning apart (YA) and the open K–S pair sit closer. */
export const KERN: Record<string, number> = { YA: -14, AG: -4, KS: -8, RK: -2, WO: -3 };

export interface PlacedGlyph extends Glyph {
  ch: string;
  x: number;
  index: number;
}

export interface Layout {
  glyphs: PlacedGlyph[];
  width: number;
}

export const layout = (text: string): Layout => {
  const glyphs: PlacedGlyph[] = [];
  let x = 0;
  let index = 0;
  for (const ch of text) {
    if (ch === ' ') {
      x += SPACE;
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for "${ch}"`);
    if (glyphs.length) x += GAP + (KERN[`${glyphs[glyphs.length - 1]!.ch}${ch}`] ?? 0);
    glyphs.push({ ...g, ch, x, index });
    x += g.adv;
    index += 1;
  }
  return { glyphs, width: x };
};

/** Static SVG of the wordmark, viewBox padded by half a stroke on every side. */
export const wordmarkSvg = (text = 'YAGI WORKSHOP', color: string = CREAM): string => {
  const { glyphs, width } = layout(text);
  const pad = STROKE / 2 + 2;
  const body = glyphs
    .map((g) => {
      const d = g.paths.map((p) => `<path d="${p}"/>`).join('');
      return `<g transform="translate(${g.x} 0)"${g.clip ? ' clip-path="url(#cap)"' : ''}>${d}</g>`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${width + 2 * pad} ${CAP + 2 * pad}" role="img" aria-label="${text}">` +
    `<defs><clipPath id="cap"><rect x="-40" y="0" width="240" height="${CAP}"/></clipPath></defs>` +
    `<g fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="12">${body}</g></svg>`
  );
};
