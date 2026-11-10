import { describe, expect, it } from 'vitest';
import {
  BoardCreateSchema,
  FrameAddSchema,
  FrameReorderSchema,
  FrameTextSchema,
  FrameUpdateSchema,
  STORYBOARD_ERROR_CODES,
  STORYBOARD_OPERATIONS,
  STORYBOARD_OPERATION_SCHEMAS,
  animaticTimeline,
  byFileName,
  changedFrames,
  cutLabelParts,
  formatRunTime,
  frameIndexAt,
  frameSeconds,
  groupLineages,
  nextDecisions,
  orderBoards,
  splitParagraphs,
  storyboardHttpStatus,
  storyboardRoomHref,
  totalSeconds,
} from '@/lib/brand-rooms/storyboard-contracts';
import { applyParagraphs, cutText, isDirty, moveCut, parseSeconds, planSave, type DraftCut } from '@/components/brand-rooms/storyboard/editor-model';
import type { StoryboardFrameDetail } from '@/lib/brand-rooms/storyboard-contracts';

/** docs/BRAND-ROOMS.md §5 — the storyboard contract's schemas and pure helpers, and the editor's working copy. */
const ID = '00000000-0000-4000-8000-000000000001';
const scope = { organizationId: ID, projectId: ID, storyboardId: ID };

describe('schemas', () => {
  it('has a schema for every operation and an HTTP status for every code', () => {
    expect(Object.keys(STORYBOARD_OPERATION_SCHEMAS).sort()).toEqual([...STORYBOARD_OPERATIONS].sort());
    for (const code of STORYBOARD_ERROR_CODES) expect(storyboardHttpStatus(code)).toBeGreaterThanOrEqual(400);
    expect(storyboardHttpStatus('not_found')).toBe(404);
    expect(storyboardHttpStatus('forbidden')).toBe(403);
  });

  it('normalises a cut’s words: labels on one line, empty clears, length rounded to tenths', () => {
    expect(FrameTextSchema.parse({ scene: '  1 ', shot: '', description: ' A\r\nB ', camera: '  ', audio: 'VO: hi', seconds: 2.345 })).toEqual({
      scene: '1',
      shot: null,
      description: 'A\nB',
      camera: null,
      audio: 'VO: hi',
      seconds: 2.3,
    });
    expect(FrameTextSchema.safeParse({ description: 'x'.repeat(2001) }).success).toBe(false);
    expect(FrameTextSchema.safeParse({ camera: 'x'.repeat(301) }).success).toBe(false);
    expect(FrameTextSchema.safeParse({ seconds: 601 }).success).toBe(false);
    expect(FrameTextSchema.safeParse({ seconds: -1 }).success).toBe(false);
    expect(FrameTextSchema.safeParse({ scene: 'x'.repeat(21) }).success).toBe(false);
  });

  it('wants a title, one source for a studio cut, and each cut once in a reorder or update', () => {
    expect(BoardCreateSchema.safeParse({ organizationId: ID, projectId: ID, title: '   ' }).success).toBe(false);
    expect(FrameAddSchema.safeParse({ ...scope }).success).toBe(false);
    expect(FrameAddSchema.safeParse({ ...scope, assetId: ID, outputId: ID }).success).toBe(false);
    expect(FrameAddSchema.safeParse({ ...scope, assetId: ID }).success).toBe(true);
    expect(FrameReorderSchema.safeParse({ ...scope, frameIds: [ID, ID] }).success).toBe(false);
    expect(FrameUpdateSchema.safeParse({ ...scope, frames: [] }).success).toBe(false);
    expect(FrameUpdateSchema.safeParse({ ...scope, frames: [{ frameId: ID }, { frameId: ID }] }).success).toBe(false);
  });
});

describe('time', () => {
  it('plays a cut without a length for two seconds and sums the running time', () => {
    expect(frameSeconds(null)).toBe(2);
    expect(frameSeconds(0)).toBe(2);
    expect(frameSeconds(3.5)).toBe(3.5);
    expect(totalSeconds([{ seconds: null }, { seconds: 1.5 }, { seconds: 4 }])).toBe(7.5);
    expect(formatRunTime(7.5)).toBe('0:07.5');
    expect(formatRunTime(65)).toBe('1:05');
  });

  it('finds the cut on screen at a moment of the animatic', () => {
    const { starts, total } = animaticTimeline([{ seconds: 1 }, { seconds: null }, { seconds: 0.5 }]);
    expect(starts).toEqual([0, 1000, 3000]);
    expect(total).toBe(3500);
    expect(frameIndexAt(starts, 0)).toBe(0);
    expect(frameIndexAt(starts, 999)).toBe(0);
    expect(frameIndexAt(starts, 1000)).toBe(1);
    expect(frameIndexAt(starts, 3400)).toBe(2);
    expect(frameIndexAt([], 10)).toBe(-1);
  });
});

describe('labels, paragraphs and file order', () => {
  it('labels a cut by its scene and shot, or by its place', () => {
    expect(cutLabelParts({ scene: '1', shot: '3' }, 0)).toEqual({ scene: '1', shot: '3' });
    expect(cutLabelParts({ scene: null, shot: null }, 4)).toEqual({ scene: null, shot: '5' });
  });

  it('splits pasted text at blank lines and keeps single line breaks', () => {
    expect(splitParagraphs('One\nstill one\n\n\n  Two  \r\n\r\nThree\n \n')).toEqual(['One\nstill one', 'Two', 'Three']);
    expect(splitParagraphs('   ')).toEqual([]);
  });

  it('orders pictures by name with numbers by value', () => {
    expect(byFileName([{ name: '10.png' }, { name: '2.png' }, { name: '01.jpg' }]).map((f) => f.name)).toEqual(['01.jpg', '2.png', '10.png']);
  });
});

describe('versions', () => {
  const cut = (id: string, picture: string, description = '') => ({ id, picture, scene: null, shot: null, description, camera: null, audio: null, seconds: null });

  it('finds changed cuts, ignores order, and counts a reworded cut once', () => {
    const before = [cut('a', 'p1', 'x'), cut('b', 'p2', 'y'), cut('c', 'p3')];
    expect(changedFrames(before, [cut('c2', 'p3'), cut('a2', 'p1', 'x'), cut('b2', 'p2', 'y')])).toEqual({ changed: [], removed: 0 });
    expect(changedFrames(before, [cut('a2', 'p1', 'x'), cut('b2', 'p2', 'reworded'), cut('c2', 'p3')])).toEqual({ changed: ['b2'], removed: 0 });
    expect(changedFrames(before, [cut('a2', 'p1', 'x')])).toEqual({ changed: [], removed: 2 });
    expect(changedFrames(before, [...before, cut('d', 'p4')].map((c) => ({ ...c, id: `${c.id}2` })))).toEqual({ changed: ['d2'], removed: 0 });
  });

  it('orders the picker by latest activity per storyboard, versions newest first', () => {
    const boards = [
      { id: '1', lineageId: 'A', version: 1, updatedAt: '2026-11-01T00:00:00Z' },
      { id: '2', lineageId: 'B', version: 1, updatedAt: '2026-11-02T00:00:00Z' },
      { id: '3', lineageId: 'A', version: 2, updatedAt: '2026-11-03T00:00:00Z' },
    ];
    expect(orderBoards(boards).map((b) => b.id)).toEqual(['3', '1', '2']);
    expect(groupLineages(boards).map((l) => [l.lineageId, l.versions.map((v) => v.version)])).toEqual([
      ['A', [2, 1]],
      ['B', [1]],
    ]);
  });

  it('lets a brand decide only on a shared board', () => {
    expect(nextDecisions('draft')).toEqual([]);
    expect(nextDecisions('shared')).toEqual(['approved', 'changes_requested']);
    expect(nextDecisions('approved')).toEqual(['shared']);
  });

  it('links to the room tab on a board and a cut', () => {
    expect(storyboardRoomHref('o', 'p', 'b', 'f')).toBe('/brand/rooms/p?organizationId=o&tab=storyboard&board=b&frame=f');
    expect(storyboardRoomHref('o', 'p')).toBe('/brand/rooms/p?organizationId=o&tab=storyboard');
  });
});

describe('the editor’s working copy', () => {
  const frame = (id: string, description = ''): StoryboardFrameDetail => ({
    id,
    idx: 0,
    scene: null,
    shot: null,
    url: `/m/${id}.png`,
    thumbUrl: null,
    width: 10,
    height: 10,
    description,
    camera: null,
    audio: null,
    seconds: null,
    threadCount: 0,
    sourceAssetId: null,
  });
  const draft = (f: StoryboardFrameDetail): DraftCut => ({ key: f.id, id: f.id, previewUrl: f.url, width: 10, height: 10, scene: '', shot: '', description: f.description, camera: '', audio: '', seconds: '' });
  const fresh = (key: string): DraftCut => ({ key, file: Object.assign(new Blob(['x'], { type: 'image/png' }), { name: `${key}.png` }), previewUrl: 'blob:x', width: null, height: null, scene: '', shot: '', description: '', camera: '', audio: '', seconds: '' });

  it('reads lengths typed as text', () => {
    expect(parseSeconds('2.5')).toBe(2.5);
    expect(parseSeconds('3초')).toBe(3);
    expect(parseSeconds('4s')).toBe(4);
    expect(parseSeconds('1,5')).toBe(1.5);
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('soon')).toBeNull();
    expect(parseSeconds('900')).toBe(600);
  });

  it('turns the boxes into the contract’s words', () => {
    expect(cutText({ ...fresh('a'), scene: ' 2 ', shot: '', description: ' Hello ', seconds: '1.25' })).toEqual({ scene: '2', shot: null, description: 'Hello', camera: null, audio: null, seconds: 1.3 });
  });

  it('fills descriptions from pasted paragraphs in order and reports the leftovers', () => {
    const { cuts, leftover } = applyParagraphs([fresh('a'), fresh('b')], 'One\n\nTwo\n\nThree');
    expect(cuts.map((c) => c.description)).toEqual(['One', 'Two']);
    expect(leftover).toBe(1);
  });

  it('plans the smallest save: deletes, changed words, new pictures, and a reorder only when needed', () => {
    const original = [frame('a', 'A'), frame('b', 'B'), frame('c', 'C')];
    const untouched = original.map(draft);
    expect(planSave(original, untouched)).toEqual({ deletes: [], updates: [], uploads: [], reorder: false });
    expect(isDirty(original, untouched, 'T', 'T')).toBe(false);
    expect(isDirty(original, untouched, 'T2', 'T')).toBe(true);

    const edited = [{ ...draft(original[2]!) }, { ...draft(original[0]!), description: 'A2' }, fresh('n')];
    const plan = planSave(original, edited);
    expect(plan.deletes).toEqual(['b']);
    expect(plan.updates).toEqual([{ frameId: 'a', scene: null, shot: null, description: 'A2', camera: null, audio: null, seconds: null }]);
    expect(plan.uploads.map((c) => c.key)).toEqual(['n']);
    expect(plan.reorder).toBe(true);
    expect(planSave(original, [...untouched, fresh('n')]).reorder).toBe(false);
    expect(planSave(original, [fresh('n'), ...untouched]).reorder).toBe(true);
  });

  it('moves a cut', () => {
    expect(moveCut(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveCut(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveCut(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
