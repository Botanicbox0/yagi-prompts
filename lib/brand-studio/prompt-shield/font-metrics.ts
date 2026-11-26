/**
 * The horizontal advance of every character an OpenType font maps, read straight from its tables (`head`,
 * `hhea`, `hmtx`, `cmap` formats 4 and 12). Used to build and to check `glyph-widths.ts`, the table the prompt
 * pages are laid out with (./layout.ts), so the server never has to open the font to count pages.
 */

export interface FontMetrics {
  unitsPerEm: number;
  /** Code point -> advance width in font units, for every code point the font maps to a real glyph. */
  advances: Map<number, number>;
}

function tables(view: DataView): Map<string, { offset: number; length: number }> {
  const count = view.getUint16(4);
  const found = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    found.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  return found;
}

/** Code point -> glyph id from the best Unicode subtable (format 12 if present, else format 4). */
function characterMap(view: DataView, cmapOffset: number): Map<number, number> {
  const count = view.getUint16(cmapOffset + 2);
  let format4 = -1;
  let format12 = -1;
  for (let i = 0; i < count; i += 1) {
    const at = cmapOffset + 4 + i * 8;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const offset = cmapOffset + view.getUint32(at + 4);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) format12 = offset;
    if (format === 4) format4 = offset;
  }
  const map = new Map<number, number>();
  if (format12 >= 0) {
    const groups = view.getUint32(format12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = format12 + 16 + g * 12;
      const start = view.getUint32(at);
      const end = view.getUint32(at + 4);
      const glyph = view.getUint32(at + 8);
      for (let cp = start; cp <= end; cp += 1) map.set(cp, glyph + (cp - start));
    }
    return map;
  }
  if (format4 < 0) throw new Error('font has no Unicode cmap');
  const segX2 = view.getUint16(format4 + 6);
  const ends = format4 + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s += 1) {
    const end = view.getUint16(ends + s * 2);
    const start = view.getUint16(starts + s * 2);
    const delta = view.getInt16(deltas + s * 2);
    const rangeAt = ranges + s * 2;
    const rangeOffset = view.getUint16(rangeAt);
    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const raw = view.getUint16(rangeAt + rangeOffset + (cp - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) map.set(cp, glyph);
    }
  }
  return map;
}

export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tables(view);
  const head = t.get('head');
  const hhea = t.get('hhea');
  const hmtx = t.get('hmtx');
  const cmap = t.get('cmap');
  if (!head || !hhea || !hmtx || !cmap) throw new Error('font is missing a metrics table');
  const unitsPerEm = view.getUint16(head.offset + 18);
  const longMetrics = view.getUint16(hhea.offset + 34);
  const advanceOf = (glyph: number): number => view.getUint16(hmtx.offset + Math.min(glyph, longMetrics - 1) * 4);
  const advances = new Map<number, number>();
  for (const [cp, glyph] of characterMap(view, cmap.offset)) {
    if (glyph > 0) advances.set(cp, advanceOf(glyph));
  }
  return { unitsPerEm, advances };
}
