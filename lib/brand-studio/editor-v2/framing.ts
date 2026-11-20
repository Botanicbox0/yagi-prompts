/**
 * Editing studio v2, V1 — how a picture sits in the frame on the organization's real film (review
 * round 1, item 5: same film, same picture).
 *
 * The current editor's exporter frames every picture by one rule, in its private `drawVideoCover`
 * (lib/brand-studio/compose/export-client.ts:37-64): it covers the frame (the edges are cropped)
 * unless the picture's shape is far from the frame's, `|ln(video ratio / frame ratio)| > 0.35`, and
 * then fits it inside, centred, on its dark background (#0B0C0E); sizes and offsets are rounded to
 * whole pixels; a picture whose size is not known yet counts as the frame's size. It is mirrored here as
 * ONE pure function, used by both v2's preview and v2's export on a real film, so a landscape clip in a
 * vertical film looks the same in the current editor's file, v2's preview and v2's file. (V1 offers no
 * framing control on a real film: nothing stores one. The sample film keeps its own control.)
 */

/** The current exporter's background, where a fitted picture leaves bars. */
export const CURRENT_EXPORT_BACKGROUND = '#0B0C0E';
/** How far apart the shapes may be (natural log of the ratio of ratios) before the picture is fitted. */
export const CURRENT_EXPORT_FIT_LIMIT = 0.35;

export interface FramedPicture {
  fit: 'fill' | 'fit';
  /** Where the picture is drawn in the frame, in whole pixels (negative when the edges are cropped). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function currentExportFrame(videoWidth: number, videoHeight: number, frameWidth: number, frameHeight: number): FramedPicture {
  const vw = videoWidth || frameWidth;
  const vh = videoHeight || frameHeight;
  const ratioDiff = Math.abs(Math.log(vw / vh / (frameWidth / frameHeight)));
  const fit = ratioDiff > CURRENT_EXPORT_FIT_LIMIT ? 'fit' : 'fill';
  const scale = fit === 'fit' ? Math.min(frameWidth / vw, frameHeight / vh) : Math.max(frameWidth / vw, frameHeight / vh);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);
  return { fit, x: Math.round((frameWidth - width) / 2), y: Math.round((frameHeight - height) / 2), width, height };
}
