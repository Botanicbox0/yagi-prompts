/**
 * GPT Image 2.6 markup edits: a transparent PNG the size of the first input image with a red outline drawn
 * where the change goes ("markup", OpenAI image prompting guide; Sunra API lane OpenAPI document, both read
 * 2026-11-19: "Transparent PNG annotations guiding the edit; mutually exclusive with mask"). The prompt then
 * says "the area inside the red outline" and asks for the outline to be removed (enhancer/profiles/gpt-image.ts
 * `GPT_IMAGE_MARKUP_RULE`).
 *
 * NOT WIRED (2026-11-19). The only studio flow with a marked area is the partial edit, which runs on Seedream 5.5
 * whatever was picked (founder 2026-11-17), and the account lane's `create_image` has no markup field. What it
 * would take: an image run on GPT Image 2.6 with an attached picture AND a box drawn on it in the viewer (a new
 * `params.markupBox`), the overlay below stored as a PNG and passed to `gptMarkupEditRequest` (provider/requests.ts) on the API lane
 * only, and `buildSystemInstruction(..., { markup: true })` for the prompt. Server-only (sharp).
 */
import sharp from 'sharp';

/** A box in fractions of the picture (0..1), as the studio's region boxes are. */
export interface MarkupBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** The overlay as SVG: transparent everywhere except a red outline around the box. */
export function markupOverlaySvg(width: number, height: number, box: MarkupBox): string {
  const W = Math.max(16, Math.round(width));
  const H = Math.max(16, Math.round(height));
  const x = clamp(box.x) * W;
  const y = clamp(box.y) * H;
  const w = Math.max(4, clamp(box.w) * W);
  const h = Math.max(4, clamp(box.h) * H);
  // A line a little under 1 % of the short side reads clearly without hiding what it marks.
  const stroke = Math.max(3, Math.round(Math.min(W, H) * 0.008));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${(x + stroke / 2).toFixed(1)}" y="${(y + stroke / 2).toFixed(1)}" width="${Math.max(1, w - stroke).toFixed(1)}" height="${Math.max(1, h - stroke).toFixed(1)}" fill="none" stroke="#ff0000" stroke-width="${stroke}"/></svg>`;
}

/** The overlay PNG, exactly `width` x `height`, with an alpha channel. */
export async function markupOverlayPng(width: number, height: number, box: MarkupBox): Promise<Uint8Array> {
  const svg = markupOverlaySvg(width, height, box);
  const png = await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer();
  return new Uint8Array(png);
}
