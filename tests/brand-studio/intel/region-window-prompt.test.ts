import { describe, expect, it } from 'vitest';
import { composeFallbackPrompt, enhancePrompt } from '@/lib/brand-studio/enhancer';
import { describeSelection, planRegionWindow, selectionLine } from '@/lib/brand-studio/region-edit';
import { ENV, input, mockGemini, sentBody } from './helpers';

/**
 * Region edit v2: the engine gets the wide window and no mask, so the words carry where the part is.
 * The prompt writer is told Figure 1 is the picture (not a crop) and sees a close-up of the box.
 */
const PNG = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: 'image/png' };
const wide = { where: 'bottom left', left: 27, top: 81, right: 41, bottom: 89, closeUp: PNG };

describe('where the box sits', () => {
  it('names the place in words and whole percentages of the window', () => {
    const plan = planRegionWindow({ width: 1112, height: 834 }, { x: 0.275, y: 0.815, w: 0.135, h: 0.075 });
    expect(describeSelection(plan)).toEqual({ where: 'bottom middle', left: 27, top: 81, right: 41, bottom: 89 });
    expect(selectionLine(describeSelection(plan))).toBe(
      'The part to change is in the bottom middle of Figure 1, about 27-41% from the left edge and 81-89% from the top edge; change nothing outside it.',
    );
    expect(describeSelection(planRegionWindow({ width: 1000, height: 1000 }, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).where).toBe('centre');
    expect(describeSelection(planRegionWindow({ width: 1000, height: 1000 }, { x: 0.8, y: 0.4, w: 0.15, h: 0.2 })).where).toBe('right side');
    expect(describeSelection(planRegionWindow({ width: 1000, height: 1000 }, { x: 0.4, y: 0.02, w: 0.2, h: 0.1 })).where).toBe('top middle');
  });
});

describe('prompt writer, region edit v2', () => {
  it('falls back to words that name the place', () => {
    const r = composeFallbackPrompt(input({ kind: 'region_edit', prompt: '유리 꽃병에 튤립 한 송이로', regionWindow: wide, editCropThumb: PNG }));
    expect(r.prompt.startsWith('In Figure 1, change only the boxed part in the bottom left: ')).toBe(true);
    expect(r.prompt).toContain('Do not move or resize anything else.');
  });

  it('tells the writer Figure 1 is the picture and shows it the close-up', async () => {
    const fetch = mockGemini({ prompt: 'In Figure 1, change only the teapot on the low table at the bottom left into a glass vase; do not move or resize anything else.', notes: '' });
    await enhancePrompt(input({ kind: 'region_edit', prompt: '유리 꽃병으로', regionWindow: wide, editCropThumb: PNG }), { fetch, env: ENV });
    const body = sentBody(fetch);
    const system = body.systemInstruction.parts.map((p) => p.text).join('\n');
    expect(system).toContain("is the customer's picture (or a wide part of it) at its own size, not a crop");
    expect(system).toContain('bottom left of Figure 1, 27-41% from the left edge and 81-89% from the top edge');
    expect(system).not.toContain('enlarged crop');
    const texts = body.contents[0]!.parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('\n');
    expect(texts).toContain('Close-up of the boxed part of Figure 1');
    expect(body.contents[0]!.parts.filter((p) => 'inlineData' in p || 'inline_data' in p)).toHaveLength(2);
  });

  it('keeps the crop wording when there is no window', async () => {
    const fetch = mockGemini({ prompt: 'In Figure 1, change only the label; do not move or resize anything else.', notes: '' });
    await enhancePrompt(input({ kind: 'region_edit', prompt: '라벨', editCropThumb: PNG }), { fetch, env: ENV });
    const system = sentBody(fetch).systemInstruction.parts.map((p) => p.text).join('\n');
    expect(system).toContain('enlarged crop');
    expect(system).not.toContain('not a crop');
  });
});
