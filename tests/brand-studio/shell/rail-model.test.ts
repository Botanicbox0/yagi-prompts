import { describe, expect, it } from 'vitest';
import {
  RAIL_HREF,
  countByGroup,
  dropItem,
  foldSummary,
  jobGroup,
  moveItem,
  onBoardFor,
  orderItems,
  parseJobMemory,
  parseOrder,
  parseRailState,
  railActive,
  railCookieExpanded,
  railItems,
  toastFor,
} from '@/components/brand-workspace/rail-model';

/** docs/BRAND-STUDIO-V3.md §3 — the rail's rules, without React. */
describe('rail items', () => {
  it('lists 이미지 스튜디오 · 비디오 스튜디오 · 캠페인 · 크리에이터 · 에셋 in that order (리뷰 and 브랜드 키트 hidden)', () => {
    expect(railItems({ studio: true, creators: true, identity: true })).toEqual(['image', 'video', 'campaigns', 'creators', 'assets']);
    expect(RAIL_HREF).toMatchObject({
      image: '/brand/studio',
      video: '/brand/studio/video',
      review: '/brand/studio/review',
      campaigns: '/brand',
      creators: '/brand/creators',
      assets: '/brand/library',
      brandKit: '/brand/identity',
    });
  });

  it('shows the two studio items only while the studio is visible, creators only while the pool is', () => {
    expect(railItems({ studio: false, creators: false, identity: false })).toEqual(['campaigns', 'assets']);
    expect(railItems({ studio: false, creators: true, identity: true })).toEqual(['campaigns', 'creators', 'assets']);
  });
});

describe('the current item', () => {
  it('keeps 이미지 off on the video and review screens', () => {
    expect(railActive('/brand/studio', '/brand/studio')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio/video')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio/compose')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio/review')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio/review/abc')).toBe(false);
    expect(railActive('/brand/studio/video', '/brand/studio/video')).toBe(true);
    expect(railActive('/brand/studio/video', '/brand/studio/compose')).toBe(true);
    expect(railActive('/brand/studio/review', '/brand/studio/review/abc')).toBe(true);
    expect(railActive('/brand/studio/video', '/brand/studio')).toBe(false);
    // An older studio sub-page is still the image studio, and a sibling path is not a child.
    expect(railActive('/brand/studio', '/brand/studio/1f2e')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio-old')).toBe(false);
  });

  it('gives campaigns the home and every campaign page, nothing else', () => {
    expect(railActive('/brand', '/brand')).toBe(true);
    expect(railActive('/brand', '/brand/projects/new')).toBe(true);
    expect(railActive('/brand', '/brand/library')).toBe(false);
    expect(railActive('/brand/library', '/brand/library')).toBe(true);
    expect(railActive('/brand/members', '/brand/members')).toBe(true);
    expect(railActive('/brand/members', '/brand/membership')).toBe(false);
  });
});

describe('order', () => {
  const all = railItems({ studio: true, creators: true, identity: true });

  it('applies the saved order and seats unknown items beside their default neighbour', () => {
    expect(orderItems(all, ['/brand', '/brand/studio/video'])).toEqual(['image', 'campaigns', 'creators', 'assets', 'video']);
    // An order saved before video existed: it appears next to image, not at the end.
    expect(orderItems(all, ['/brand/studio', '/brand', '/brand/library'])).toEqual(['image', 'video', 'campaigns', 'creators', 'assets']);
    // The topbar's older order (no video) still applies to what it knows.
    expect(orderItems(all, ['/brand/library', '/brand/studio'])).toEqual(['assets', 'image', 'video', 'campaigns', 'creators']);
    expect(orderItems(all, [])).toEqual(all);
  });

  it('moves one place and stops at the ends; drops onto a target', () => {
    expect(moveItem(all, 'video', -1).slice(0, 2)).toEqual(['video', 'image']);
    expect(moveItem(all, 'image', -1)).toEqual(all);
    expect(moveItem(all, 'assets', 1)).toEqual(all);
    expect(dropItem(all, 'assets', 'image').slice(0, 2)).toEqual(['assets', 'image']);
    expect(dropItem(all, 'image', 'image')).toEqual(all);
  });

  it('reads stored values defensively', () => {
    expect(parseOrder('["/brand","/brand/studio"]')).toEqual(['/brand', '/brand/studio']);
    expect(parseOrder('[1,2]')).toEqual([]);
    expect(parseOrder('not json')).toEqual([]);
    expect(parseOrder(null)).toEqual([]);
    expect(parseRailState('{"expanded":true}')).toEqual({ expanded: true });
    expect(parseRailState('{"expanded":"yes"}')).toBeNull();
    expect(parseRailState('{')).toBeNull();
    expect(railCookieExpanded('1')).toBe(true);
    expect(railCookieExpanded('0')).toBe(false);
    expect(railCookieExpanded(undefined)).toBe(false);
  });
});

describe('background jobs', () => {
  it('groups kinds by the screen that shows them', () => {
    expect(jobGroup('image')).toBe('image');
    expect(jobGroup('region_edit')).toBe('image');
    for (const kind of ['video', 'video_remix', 'video_final']) expect(jobGroup(kind)).toBe('video');
    expect(countByGroup([{ kind: 'image' }, { kind: 'region_edit' }, { kind: 'video_remix' }])).toEqual({ image: 2, video: 1 });
    expect(onBoardFor('image', '/brand/studio')).toBe(true);
    expect(onBoardFor('image', '/brand/studio/video')).toBe(false);
    expect(onBoardFor('video', '/brand/studio/video')).toBe(true);
  });

  it('toasts a finished job only away from its own board, never a canceled or an announced one', () => {
    const done = { id: 'j1', kind: 'image', status: 'succeeded' as const };
    expect(toastFor(done, '/brand', new Set())).toEqual({ id: 'j1', group: 'image', outcome: 'done' });
    expect(toastFor(done, '/brand/studio/video', new Set())).toEqual({ id: 'j1', group: 'image', outcome: 'done' });
    expect(toastFor(done, '/brand/studio', new Set())).toBeNull();
    expect(toastFor({ ...done, status: 'canceled' }, '/brand', new Set())).toBeNull();
    expect(toastFor({ ...done, status: 'failed', kind: 'video' }, '/brand', new Set())).toEqual({ id: 'j1', group: 'video', outcome: 'failed' });
    expect(toastFor(done, '/brand', new Set(['j1']))).toBeNull();
  });

  it('announces only jobs this tab saw running, once, and remembers ones that finished on their board', () => {
    const empty = { open: [], announced: [] };
    // First read on a page: an old finished job nobody here watched is not announced.
    const first = foldSummary(empty, { open: [{ id: 'run' }], settled: [{ id: 'old', kind: 'image', status: 'succeeded' }] }, '/brand');
    expect(first.toasts).toEqual([]);
    expect(first.memory.open).toEqual(['run']);
    // It finishes while the person is on campaigns: one toast.
    const second = foldSummary(first.memory, { open: [], settled: [{ id: 'run', kind: 'image', status: 'succeeded' }] }, '/brand');
    expect(second.toasts).toEqual([{ id: 'run', group: 'image', outcome: 'done' }]);
    expect(second.memory).toEqual({ open: [], announced: ['run'] });
    // The next read sees it again in `settled`: no second toast.
    expect(foldSummary(second.memory, { open: [], settled: [{ id: 'run', kind: 'image', status: 'succeeded' }] }, '/brand').toasts).toEqual([]);
    // Finished while watching its own board: no toast now, none after leaving the board either.
    const onBoard = foldSummary({ open: ['v'], announced: [] }, { open: [], settled: [{ id: 'v', kind: 'video', status: 'succeeded' }] }, '/brand/studio/video');
    expect(onBoard.toasts).toEqual([]);
    expect(foldSummary(onBoard.memory, { open: [], settled: [{ id: 'v', kind: 'video', status: 'succeeded' }] }, '/brand').toasts).toEqual([]);
  });

  it('reads the tab memory defensively', () => {
    expect(parseJobMemory('{"open":["a",1],"announced":["b"]}')).toEqual({ open: ['a'], announced: ['b'] });
    expect(parseJobMemory('nope')).toEqual({ open: [], announced: [] });
    expect(parseJobMemory(null)).toEqual({ open: [], announced: [] });
  });
});
