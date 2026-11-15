import { describe, expect, it } from 'vitest';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { regionEditInput } from '@/components/brand-studio/dock-model';
import { fillSourcesToDelete, listedJobs } from '@/components/brand-studio/store';

/**
 * "빈 곳 채우기" runs are internal: the screen lists never show them (the editor still receives them),
 * and the picture uploaded for them is deleted once every run that reads it has settled.
 */
const job = (id: string, status: StudioJobView['status'], purpose?: 'fill') => ({ id, status, kind: 'region_edit' as const, ...(purpose ? { purpose } : {}) });

describe('listedJobs', () => {
  it('leaves out fill strips and keeps everything else in order', () => {
    const jobs = [job('a', 'succeeded'), job('b', 'running', 'fill'), job('c', 'failed'), job('d', 'succeeded', 'fill')];
    expect(listedJobs(jobs).map((j) => j.id)).toEqual(['a', 'c']);
  });
  it('returns the same array when there is nothing to leave out', () => {
    const jobs = [job('a', 'succeeded')];
    expect(listedJobs(jobs)).toBe(jobs);
  });
});

describe('regionEditInput', () => {
  const base = {
    ids: { organizationId: '0b9f1c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a', requestId: 'req_0123456789abcdef' },
    source: { assetId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d' },
    box: { x: 0.7, y: 0, w: 0.3, h: 1 },
    instruction: 'The flat grey band along the RIGHT edge is empty canvas.',
    draft: { medium: 'image' as const, model: 'nano-banana-pro', enhance: false },
  };
  it('marks a fill strip, and only a fill strip', () => {
    expect(regionEditInput({ ...base, purpose: 'fill' })).toMatchObject({ kind: 'region_edit', purpose: 'fill', enhance: false, prompt: base.instruction });
    expect(regionEditInput(base)).not.toHaveProperty('purpose');
  });
});

describe('fillSourcesToDelete', () => {
  it('waits until every run that reads the picture has settled', () => {
    const tracked = new Map([
      ['p1', ['a', 'b']],
      ['p2', ['c']],
    ]);
    expect(fillSourcesToDelete(tracked, [job('a', 'succeeded', 'fill'), job('b', 'running', 'fill'), job('c', 'queued', 'fill')])).toEqual([]);
    expect(fillSourcesToDelete(tracked, [job('a', 'succeeded', 'fill'), job('b', 'canceled', 'fill'), job('c', 'finishing', 'fill')])).toEqual(['p1']);
    expect(fillSourcesToDelete(tracked, [job('a', 'failed', 'fill'), job('b', 'succeeded', 'fill'), job('c', 'succeeded', 'fill')])).toEqual(['p1', 'p2']);
  });
  it('deletes at once when no run was started, and waits for runs it has not seen yet', () => {
    expect(fillSourcesToDelete(new Map([['p', []]]), [])).toEqual(['p']);
    expect(fillSourcesToDelete(new Map([['p', ['x']]]), [])).toEqual([]);
  });
});
