/**
 * Draws one page of a sent video prompt as a PNG (the video prompt shield). `next/og` (satori + resvg) on the
 * Node runtime with the bundled server font only: no system font, no SVG text in sharp. The lines come from
 * ./layout.ts already wrapped and already reduced to characters the font has, so satori never asks for another
 * font or an emoji picture (its fallback would send those characters to a font service).
 *
 * Dark text on white, one style; the screen frames it. Nothing of the text reaches a log or a header.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { SERVER_FONT_FILE } from './glyph-source';
import { PROMPT_PAGE, promptPageHeight, promptPages } from './layout';

const FAMILY = 'TwingsPromptPage';
let fonts: Array<{ name: string; data: ArrayBuffer; weight: 400; style: 'normal' }> | null = null;

/** The font, read once per process (traced into the route's bundle by next.config.ts). */
function pageFonts() {
  if (!fonts) {
    const bytes = readFileSync(path.join(process.cwd(), SERVER_FONT_FILE));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // One array object for the life of the process: satori keeps its parsed font keyed by it.
    fonts = [{ name: FAMILY, data, weight: 400, style: 'normal' }];
  }
  return fonts;
}

type Node = { type: string; props: { style: Record<string, string | number>; children?: string | Node[] } };

function pageElement(lines: readonly string[]): Node {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        color: '#1d1f24',
        padding: `${PROMPT_PAGE.padY}px ${PROMPT_PAGE.padX}px`,
        fontFamily: FAMILY,
        fontSize: PROMPT_PAGE.fontSize,
        overflow: 'hidden',
      },
      children: lines.map((line) => ({
        type: 'div',
        props: {
          style: { display: 'flex', height: PROMPT_PAGE.lineHeight, lineHeight: `${PROMPT_PAGE.lineHeight}px`, whiteSpace: 'pre', overflow: 'hidden' },
          children: line === '' ? ' ' : line,
        },
      })),
    },
  };
}

/** Page `page` (1-based) of `text`, or null when there is no such page. */
export async function renderPromptPage(text: string, page: number): Promise<{ png: Buffer; width: number; height: number } | null> {
  const pages = promptPages(text);
  const lines = Number.isInteger(page) && page >= 1 ? pages[page - 1] : undefined;
  if (!lines) return null;
  const height = promptPageHeight(lines.length);
  const response = new ImageResponse(pageElement(lines) as never, { width: PROMPT_PAGE.width, height, fonts: pageFonts() });
  const png = Buffer.from(await response.arrayBuffer());
  return { png, width: PROMPT_PAGE.width, height };
}
