/**
 * Which part of a poster the admin wall's 1:1 thumbnail shows (staff report, 2026-11-02).
 *
 * Percentages as CSS `object-position` reads them. No image bytes change, and the public cards do not
 * read this: `shapeAsset` allowlists what leaves the server.
 */
export interface PosterFocus {
  x: number;
  y: number;
}

export const POSTER_FOCUS_CENTER: PosterFocus = { x: 50, y: 50 };

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const rounded = (value: number) => Math.round(value * 10) / 10;

export function formatPosterFocus(focus: PosterFocus): string {
  return `${focus.x},${focus.y}`;
}

/** The form's `x,y`. Anything else is no answer, so a broken field cannot move a saved crop. */
export function parsePosterFocus(value: string): PosterFocus | null {
  const match = /^(\d{1,3}(?:\.\d+)?),(\d{1,3}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x <= 100 && y <= 100 ? { x, y } : null;
}

export function posterObjectPosition(focus: PosterFocus | undefined): string {
  const { x, y } = focus ?? POSTER_FOCUS_CENTER;
  return `${x}% ${y}%`;
}

/** The new focus after dragging the image by `dx`,`dy` pixels in a square frame of `frame` pixels. */
export function dragPosterFocus(focus: PosterFocus, dx: number, dy: number, natural: { w: number; h: number }, frame: number): PosterFocus {
  const overflowX = natural.w > natural.h ? frame * (natural.w / natural.h - 1) : 0;
  const overflowY = natural.h > natural.w ? frame * (natural.h / natural.w - 1) : 0;
  return {
    x: overflowX > 0 ? rounded(clamp(focus.x - (dx / overflowX) * 100)) : focus.x,
    y: overflowY > 0 ? rounded(clamp(focus.y - (dy / overflowY) * 100)) : focus.y,
  };
}
