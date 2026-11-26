import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { readFontMetrics } from '@/lib/brand-studio/prompt-shield/font-metrics';
import { drawableRuns, SERVER_FONT_FILE } from '@/lib/brand-studio/prompt-shield/glyph-source';
import { GLYPH_RUNS, GLYPH_UNITS_PER_EM } from '@/lib/brand-studio/prompt-shield/glyph-widths';
import { drawableText, PROMPT_BOX, PROMPT_MORE, PROMPT_PAGE, promptPageCount, promptPageHeight, promptPages } from '@/lib/brand-studio/prompt-shield/layout';
import { renderPromptPage } from '@/lib/brand-studio/prompt-shield/render';
import { jobView } from '@/lib/brand-studio/repo';
import { worldRows } from './world';

/**
 * The video prompt shield's pictures: the font really draws Hangul, pages are what the view counts, nothing is
 * fetched for a character the font lacks, and the PNG carries no text of its own.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const LATIN = 'Slow dolly in on a cobalt bottle standing on wet slate, soft window light from the left, shallow focus. ';
const HANGUL = '젖은 돌판 위 코발트 병, 왼쪽 창가의 부드러운 빛, 얕은 심도로 천천히 다가간다. ';
const textOf = (chars: number, unit = LATIN) => unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);

function chunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    types.push(png.toString('latin1', at + 4, at + 8));
    at += 12 + length;
  }
  return types;
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const v of data) if (v < 128) dark += 1;
  return { data, info, dark };
}

describe('glyph table', () => {
  it('equals the bundled font (regenerate with scripts/prompt-shield-glyph-table.ts)', () => {
    const metrics = readFontMetrics(new Uint8Array(readFileSync(path.join(process.cwd(), SERVER_FONT_FILE))));
    const body = drawableRuns(metrics).map(([a, b, w]) => `${a.toString(36)},${b.toString(36)},${w.toString(36)}`).join(';');
    expect(GLYPH_UNITS_PER_EM).toBe(metrics.unitsPerEm);
    expect(GLYPH_RUNS).toBe(body);
  });

  it('the font has every Hangul syllable, the box, and the Latin alphabet', () => {
    const text = drawableText('가힣 AZaz09 □');
    expect(text).toBe('가힣 AZaz09 □');
    // Emoji, Han characters and private-use code points become boxes; variation selectors and joiners vanish.
    expect(drawableText('a\u{1F600}b中cd❤️e‍f')).toBe(`a${PROMPT_BOX}b${PROMPT_BOX}c${PROMPT_BOX}d${PROMPT_BOX}ef`);
    expect(drawableText('x\ty\r\nz')).toBe('x    y\nz');
  });
});

describe('pages', () => {
  it('keeps line breaks and wraps long lines inside the width', () => {
    const pages = promptPages(`first line\n\nthird line\n${textOf(400)}`);
    expect(pages).toHaveLength(1);
    const lines = pages[0]!;
    expect(lines.slice(0, 3)).toEqual(['first line', '', 'third line']);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.slice(3).join(' ').replace(/ +/g, ' ').trim()).toBe(textOf(400).replace(/ +/g, ' ').trim());
  });

  it('counts pages for 1, about 2,000, 8,000 and 15,000 characters', () => {
    const counts = [1, 2_000, 8_000, 15_000].map((n) => promptPageCount(textOf(n)));
    const hangul = [2_000, 8_000, 15_000].map((n) => promptPageCount(textOf(n, HANGUL)));
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBeGreaterThanOrEqual(3);
    expect(counts[3]).toBeGreaterThan(counts[2]!);
    expect(counts[3]).toBeLessThanOrEqual(PROMPT_PAGE.maxPages);
    expect(hangul[2]).toBeLessThanOrEqual(PROMPT_PAGE.maxPages);
    // A prompt of nothing but line breaks stops at the cap, its last line saying it goes on.
    const capped = promptPages('a\n'.repeat(7_500));
    expect(capped).toHaveLength(PROMPT_PAGE.maxPages);
    expect(capped.at(-1)!.at(-1)).toBe('…');
  });
});

describe('renderPromptPage', () => {
  it('draws a decodable, fixed-width, non-blank PNG with no text chunks', async () => {
    const out = (await renderPromptPage(`${HANGUL}\n${LATIN}`, 1))!;
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(PROMPT_PAGE.width);
    expect(meta.height).toBe(promptPageHeight(promptPages(`${HANGUL}\n${LATIN}`)[0]!.length));
    expect((await pixels(out.png)).dark).toBeGreaterThan(1_000);
    expect(chunkTypes(out.png).filter((t) => /^(tEXt|zTXt|iTXt|eXIf)$/.test(t))).toEqual([]);
    expect(out.png.includes(Buffer.from('코발트'))).toBe(false);
    expect(out.png.includes(Buffer.from('cobalt'))).toBe(false);
  });

  it('really draws Hangul: a Hangul line is not the missing-glyph box line', async () => {
    const hangul = (await renderPromptPage('가나다라마바사아자차', 1))!;
    const boxes = (await renderPromptPage(PROMPT_BOX.repeat(10), 1))!;
    const missing = (await renderPromptPage('中中中中中中中中中中', 1))!;
    expect(hangul.png.equals(boxes.png)).toBe(false);
    // Characters the font lacks are drawn exactly as the box.
    expect(missing.png.equals(boxes.png)).toBe(true);
    const a = await pixels(hangul.png);
    const b = await pixels(boxes.png);
    let differing = 0;
    for (let i = 0; i < a.data.length; i += 1) if (Math.abs(a.data[i]! - b.data[i]!) > 64) differing += 1;
    expect(differing).toBeGreaterThan(500);
  });

  it('two different texts give different pictures', async () => {
    const one = (await renderPromptPage('The bottle turns slowly.', 1))!;
    const two = (await renderPromptPage('The bottle turns quickly.', 1))!;
    expect(one.png.equals(two.png)).toBe(false);
  });

  it('never fetches or logs for characters the font lacks', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const errorSpy = vi.spyOn(console, 'error');
    const out = await renderPromptPage('emoji 😀👍🏽 flags 🇰🇷 han 中文 thai ภาษาไทย arabic العربية keycap 1️⃣ ❤️ math ∑ ⨁', 1);
    expect(out).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders every page of a 15,000-character prompt, and no page past the last', async () => {
    const text = textOf(15_000);
    const pages = promptPageCount(text);
    const timings: number[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const started = performance.now();
      const out = await renderPromptPage(text, page);
      timings.push(Math.round(performance.now() - started));
      expect(out).not.toBeNull();
    }
    expect(await renderPromptPage(text, pages + 1)).toBeNull();
    expect(await renderPromptPage(text, 0)).toBeNull();
    const mixed = textOf(15_000, `${HANGUL}${LATIN}\n`);
    const mixedTimings: number[] = [];
    for (let page = 1; page <= promptPageCount(mixed); page += 1) {
      const started = performance.now();
      await renderPromptPage(mixed, page);
      mixedTimings.push(Math.round(performance.now() - started));
    }
    // Reported, not asserted: the report quotes these lines.
    console.log(`[prompt-shield timing] latin 15000 chars: ${pages} pages, ms per page ${timings.join(',')}`);
    console.log(`[prompt-shield timing] mixed 15000 chars: ${mixedTimings.length} pages, ms per page ${mixedTimings.join(',')}`);
  }, 180_000);

  it('matches jobView sent.pages to rendered 720px pages across 600..15,000 chars (latin, hangul, mixed) and fits 15,000 Korean without ellipsis', async () => {
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'on');
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', '00000000-0000-4000-8000-00000000a001');
    try {
      const { jobs, outputs } = worldRows('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001');
      const baseJob = jobs.find((j) => j.kind === 'video' && j.final_prompt !== null)!;
      const media = createMemoryMediaStore();
      const fullHeight = promptPageHeight(PROMPT_PAGE.linesPerPage);
      const lengths = [600, 2_000, 6_000, 9_000, 15_000] as const;
      const variants = [
        ['latin', LATIN],
        ['hangul', HANGUL],
        ['mixed', `${HANGUL}${LATIN}\n`],
      ] as const;

      expect(PROMPT_PAGE.width).toBe(720);
      const summary: string[] = [];
      let onePageMs = 0;
      let largestLastPageMs = 0;

      for (const [label, unit] of variants) {
        const pageCounts: number[] = [];
        let shorterLastPages = 0;
        for (const n of lengths) {
          const text = textOf(n, unit);
          const view = jobView({ ...baseJob, final_prompt: text }, outputs, media);
          const sent = view.sent;
          expect(sent).not.toBeNull();
          const pages = promptPages(text);
          expect(sent!.pages).toBe(pages.length);
          pageCounts.push(pages.length);

          const tStart = performance.now();
          const first = (await renderPromptPage(text, 1))!;
          const firstMs = Math.round(performance.now() - tStart);
          if (label === 'hangul' && n === 600) onePageMs = firstMs;
          const firstMeta = await sharp(first.png).metadata();
          expect(first.width).toBe(720);
          expect(firstMeta.width).toBe(720);

          const lastStart = performance.now();
          const last = (await renderPromptPage(text, sent!.pages))!;
          const lastMs = Math.round(performance.now() - lastStart);
          if (label === 'hangul' && n === 15_000) largestLastPageMs = lastMs;
          const lastMeta = await sharp(last.png).metadata();
          expect(last.width).toBe(720);
          expect(lastMeta.width).toBe(720);
          expect(await renderPromptPage(text, sent!.pages + 1)).toBeNull();

          expect(last.height).toBe(promptPageHeight(pages.at(-1)!.length));
          if (pages.at(-1)!.length < PROMPT_PAGE.linesPerPage) {
            expect(lastMeta.height!).toBeLessThan(fullHeight);
            if (pages.length > 1) expect(lastMeta.height!).toBeLessThan(firstMeta.height!);
            shorterLastPages += 1;
          } else {
            expect(lastMeta.height!).toBe(fullHeight);
          }
          if (n === 15_000) {
            expect(pages.length).toBeLessThanOrEqual(PROMPT_PAGE.maxPages);
            expect(pages.at(-1)!.at(-1)).not.toBe(PROMPT_MORE);
            if (label === 'hangul') {
              for (let p = 1; p <= pages.length; p += 1) {
                const pageImg = (await renderPromptPage(text, p))!;
                const meta = await sharp(pageImg.png).metadata();
                expect(pageImg.width).toBe(720);
                expect(meta.width).toBe(720);
              }
            }
          }
        }
        expect(shorterLastPages).toBeGreaterThanOrEqual(3);
        summary.push(`${label}: ${lengths.map((n, i) => `${n}=${pageCounts[i]}p`).join(', ')}`);
      }
      console.log(`[prompt-shield fix2 size] maxPages=${PROMPT_PAGE.maxPages}; ${summary.join(' | ')}`);
      console.log(`[prompt-shield fix2 timing] one-page=${onePageMs}ms, 15000-korean-last-page=${largestLastPageMs}ms`);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 180_000);
});
