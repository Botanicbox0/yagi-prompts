import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSE_DIMENSIONS } from '@/lib/brand-studio/compose/timeline';
import { CURRENT_EXPORT_BACKGROUND, CURRENT_EXPORT_FIT_LIMIT, currentExportFrame } from '@/lib/brand-studio/editor-v2/framing';

/**
 * Review round 1, item 5: same film, same picture. On a real film v2 frames every picture by the
 * current exporter's rule (lib/brand-studio/compose/export-client.ts `drawVideoCover`, private there):
 * cover the frame, unless the picture's shape is far from the frame's (|ln(video ratio / frame ratio)|
 * > 0.35), then fit it inside, centred, on the exporter's dark background. One function, used by v2's
 * preview and v2's export, so a landscape clip in a vertical film looks the same in all three.
 */
const frame = (aspect: keyof typeof COMPOSE_DIMENSIONS) => COMPOSE_DIMENSIONS[aspect];

describe('the current exporter’s framing rule, mirrored', () => {
  it('a landscape clip in a vertical film is fitted inside with bars above and below, centred', () => {
    const { width, height } = frame('9:16');
    expect(currentExportFrame(1920, 1080, width, height)).toEqual({ fit: 'fit', x: 0, y: 656, width: 1080, height: 608 });
    expect(currentExportFrame(640, 360, width, height)).toEqual({ fit: 'fit', x: 0, y: 656, width: 1080, height: 608 });
  });

  it('a vertical clip in a wide film is fitted with bars left and right', () => {
    const { width, height } = frame('16:9');
    expect(currentExportFrame(1080, 1920, width, height)).toEqual({ fit: 'fit', x: 656, y: 0, width: 608, height: 1080 });
  });

  it('shapes close to the frame’s cover it (the edges are cropped)', () => {
    expect(currentExportFrame(1080, 1920, 1080, 1920)).toEqual({ fit: 'fill', x: 0, y: 0, width: 1080, height: 1920 });
    // 4:5 picture in a square frame: ln(0.8) = -0.223.
    expect(currentExportFrame(1080, 1350, 1080, 1080)).toEqual({ fit: 'fill', x: 0, y: -135, width: 1080, height: 1350 });
    // 4:3 picture in a 16:9 frame: ln(0.75) = -0.288.
    expect(currentExportFrame(1440, 1080, 1920, 1080)).toMatchObject({ fit: 'fill', width: 1920, height: 1440, x: 0, y: -180 });
  });

  it('the boundary: just under 0.35 covers, just over fits (strictly greater, like the exporter)', () => {
    expect(CURRENT_EXPORT_FIT_LIMIT).toBe(0.35);
    const ratio = (diff: number) => Math.exp(diff) * (1080 / 1920);
    const under = ratio(0.349);
    const over = ratio(0.351);
    expect(currentExportFrame(Math.round(under * 100000), 100000, 1080, 1920).fit).toBe('fill');
    expect(currentExportFrame(Math.round(over * 100000), 100000, 1080, 1920).fit).toBe('fit');
    // A 9:16 picture in a 4:5 frame is just over: |ln(0.703125)| = 0.3522 → fitted.
    expect(currentExportFrame(1080, 1920, 1080, 1350)).toMatchObject({ fit: 'fit', height: 1350, width: 759, x: 161, y: 0 });
  });

  it('a picture whose size is not known yet covers the frame (the exporter falls back to the frame size)', () => {
    expect(currentExportFrame(0, 0, 1080, 1920)).toEqual({ fit: 'fill', x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('the background is the exporter’s, and the rule is read from the exporter itself', () => {
    expect(CURRENT_EXPORT_BACKGROUND).toBe('#0B0C0E');
    const exporter = readFileSync(join(process.cwd(), 'lib/brand-studio/compose/export-client.ts'), 'utf8');
    const draw = exporter.slice(exporter.indexOf('function drawVideoCover('), exporter.indexOf('function wrapCaptionLines('));
    expect(draw).toContain("ctx.fillStyle = '#0B0C0E';");
    expect(draw).toContain('const ratioDiff = Math.abs(Math.log(videoRatio / frameRatio));');
    expect(draw).toContain('if (ratioDiff > 0.35) {');
    expect(draw).toContain('const vw = video.videoWidth || canvasWidth;');
  });
});

describe('v2 uses it for the real film in the preview and the export', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

  it('the preview and the export both call the one function on a real film', () => {
    expect(read('components/brand-studio/editor-v2/preview.tsx')).toContain('currentExportFrame(');
    expect(read('components/brand-studio/editor-v2/export-film.ts')).toContain('currentExportFrame(');
    expect(read('components/brand-studio/editor-v2/export-sheet.tsx')).toMatch(/framing: real \? 'current' : 'reframe'/);
  });
});
