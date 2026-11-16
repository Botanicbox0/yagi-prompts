/**
 * What a PPTX says, for Gemini (docs/BRAND-STUDIO-V6-PLAN.md §4.7): each slide's text and speaker notes
 * in presentation order, and the first pictures (PNG and JPEG only, shrunk). Nothing is rendered: there
 * is no LibreOffice on Vercel, and the text plus the pictures is what a revision needs from a deck.
 *
 * Slide order is the order of `p:sldIdLst` in `ppt/presentation.xml` through its relationships; when that
 * cannot be read, the slide file numbers. Server-only. Never logs any text from the file.
 */
import sharp from 'sharp';
import { STUDIO_DOCUMENT_SLIDES_MAX } from '../contracts';
import { ZipRefused, zipEntries, zipReader } from './zip';

export const PPTX_PICTURES_MAX = 12;
export const PPTX_PICTURE_SIDE_MAX = 1536;
/** Characters of slide text and notes handed on, across the deck. */
export const PPTX_TEXT_MAX = 60_000;

export type PptxProblem = 'not_pptx' | 'encrypted' | 'too_large' | 'too_many_slides';

export interface PptxSlide {
  n: number;
  text: string;
  notes: string;
}

export interface PptxReading {
  slides: PptxSlide[];
  pictures: Array<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }>;
}

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function unescapeXml(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)));
}

/** The text runs of a DrawingML part, one line per paragraph. */
export function drawingText(xml: string): string {
  const lines: string[] = [];
  for (const paragraph of xml.split(/<\/a:p>/)) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1]!));
    const line = runs.join('').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

/** `Id -> Target` of a relationships part, with the target resolved against `base` (a folder path). */
function relationships(xml: string | null, base: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  if (!xml) return out;
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1] ?? '';
    if (!id || !target || /\bTargetMode="External"/.test(attrs)) continue;
    out.set(id, { target: resolvePart(base, target), type });
  }
  return out;
}

function resolvePart(base: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function slideOrder(zip: ReturnType<typeof zipReader>): string[] {
  const numbered = zip
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const presentation = zip.text('ppt/presentation.xml');
  const rels = relationships(zip.text('ppt/_rels/presentation.xml.rels'), 'ppt');
  if (!presentation || !rels.size) return numbered;
  const list = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(presentation)?.[1] ?? '';
  const ordered = [...list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => rels.get(m[1]!)?.target)
    .filter((target): target is string => Boolean(target && zip.has(target)));
  return ordered.length ? ordered : numbered;
}

/** Opens the deck far enough to know it is one and how many slides it has. */
export function inspectPptx(bytes: Uint8Array): { ok: true; slides: number } | { ok: false; problem: PptxProblem } {
  try {
    const entries = zipEntries(bytes);
    const zip = zipReader(bytes, entries);
    if (!zip.has('ppt/presentation.xml') || !zip.has('[Content_Types].xml')) return { ok: false, problem: 'not_pptx' };
    const slides = slideOrder(zip).length;
    if (slides < 1) return { ok: false, problem: 'not_pptx' };
    if (slides > STUDIO_DOCUMENT_SLIDES_MAX) return { ok: false, problem: 'too_many_slides' };
    return { ok: true, slides };
  } catch (error) {
    if (error instanceof ZipRefused) return { ok: false, problem: error.reason === 'encrypted' ? 'encrypted' : error.reason === 'too_large' || error.reason === 'too_many_entries' ? 'too_large' : 'not_pptx' };
    return { ok: false, problem: 'not_pptx' };
  }
}

/** Slide text, notes and the first pictures, in presentation order. Throws `ZipRefused` on a hostile file. */
export async function readPptx(bytes: Uint8Array): Promise<PptxReading> {
  const zip = zipReader(bytes);
  const slides: PptxSlide[] = [];
  const pictureParts: string[] = [];
  let budget = PPTX_TEXT_MAX;
  const order = slideOrder(zip).slice(0, STUDIO_DOCUMENT_SLIDES_MAX);
  order.forEach((part, i) => {
    const folder = part.slice(0, part.lastIndexOf('/'));
    const file = part.slice(part.lastIndexOf('/') + 1);
    const rels = relationships(zip.text(`${folder}/_rels/${file}.rels`), folder);
    const notesPart = [...rels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const take = (text: string) => {
      const kept = text.slice(0, Math.max(0, budget));
      budget -= kept.length;
      return kept;
    };
    const text = take(drawingText(zip.text(part) ?? ''));
    const notes = take(notesPart ? drawingText(zip.text(notesPart) ?? '') : '');
    slides.push({ n: i + 1, text, notes });
    for (const rel of rels.values()) {
      if (!rel.type.endsWith('/image')) continue;
      if (!/\.(png|jpe?g)$/i.test(rel.target) || pictureParts.includes(rel.target)) continue;
      pictureParts.push(rel.target);
    }
  });
  const pictures: PptxReading['pictures'] = [];
  for (const part of pictureParts) {
    if (pictures.length >= PPTX_PICTURES_MAX) break;
    const raw = zip.read(part);
    if (!raw) continue;
    try {
      const png = /\.png$/i.test(part);
      const resized = sharp(raw, { limitInputPixels: 12_000 * 12_000 })
        .rotate()
        .resize({ width: PPTX_PICTURE_SIDE_MAX, height: PPTX_PICTURE_SIDE_MAX, fit: 'inside', withoutEnlargement: true });
      const out = png ? await resized.png().toBuffer() : await resized.jpeg({ quality: 82 }).toBuffer();
      pictures.push({ mime: png ? 'image/png' : 'image/jpeg', bytes: new Uint8Array(out) });
    } catch {
      // A picture that does not decode is skipped; the text still counts.
    }
  }
  return { slides, pictures };
}

/** The deck as the reader's text part: "Slide n: …" with its notes. */
export function pptxText(reading: PptxReading): string {
  return reading.slides
    .map((s) => [`Slide ${s.n}:`, s.text || '(no text)', ...(s.notes ? [`Notes: ${s.notes}`] : [])].join('\n'))
    .join('\n\n');
}
