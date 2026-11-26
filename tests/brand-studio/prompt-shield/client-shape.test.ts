import { describe, expect, it } from 'vitest';
import { rerunInput } from '@/components/brand-studio/dock-model';
import { designedSentence } from '@/components/brand-studio/use-dock';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { job, ORG } from '../ui/fixtures';

/**
 * The one client change the video prompt shield's server slice makes: "같은 설정으로 다시 만들기" and "지금 설계하기"
 * stay byte for byte the same requests while the shield is closed (the views have no `sent` / `architect`), and
 * do not send wrong data while it is open (a view with `finalPrompt: null`).
 */
const ids = { organizationId: ORG, requestId: 'req_shape_000001' };
const video = (patch: Partial<StudioJobView>) =>
  job(7, { kind: 'video', model: 'seedance-2.5', prompt: '병이 돈다', aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', ...patch });

describe('rerunInput, shield closed: the same JSON as before', () => {
  it('a reviewed video run sends its sentence; a designed one asks again; a typed one does not', () => {
    expect(JSON.stringify(rerunInput(video({ reviewed: true, finalPrompt: 'Read sentence' }), ids))).toBe(
      JSON.stringify({ kind: 'video', organizationId: ORG, requestId: ids.requestId, model: 'seedance-2.5', prompt: '병이 돈다', enhance: false, reviewedPrompt: 'Read sentence', references: [], aspect: '9:16', resolution: '720p', audio: 'native', seconds: 5 }),
    );
    expect(JSON.stringify(rerunInput(video({ finalPrompt: 'Designed sentence' }), ids))).toBe(
      JSON.stringify({ kind: 'video', organizationId: ORG, requestId: ids.requestId, model: 'seedance-2.5', prompt: '병이 돈다', enhance: true, references: [], aspect: '9:16', resolution: '720p', audio: 'native', seconds: 5 }),
    );
    expect(rerunInput(video({ finalPrompt: null }), ids)).toMatchObject({ enhance: false });
    expect(rerunInput(video({ finalPrompt: null }), ids)).not.toHaveProperty('reviewedFrom');
    const image = rerunInput(job(8, { aspect: '1:1', resolution: '2K' }), ids)!;
    expect(Object.keys(image)).toEqual(['kind', 'organizationId', 'requestId', 'model', 'prompt', 'enhance', 'references', 'aspect', 'resolution', 'count']);
  });
});

describe('rerunInput, shield open (finalPrompt null, sent and architect present)', () => {
  const sent = { shielded: true as const, pages: 1, version: 'abcdefghijklmnop' };

  it('a reviewed run is named, not sent (enhance on: a server whose shield closed since designs again)', () => {
    expect(rerunInput(video({ finalPrompt: null, reviewed: true, sent, architect: true }), ids)).toMatchObject({ enhance: true, reviewedFrom: { jobId: video({}).id } });
    expect(rerunInput(video({ finalPrompt: null, reviewed: true, sent, architect: true }), ids)).not.toHaveProperty('reviewedPrompt');
  });

  it('a designed run is designed again, a typed one is not', () => {
    const designed = rerunInput(video({ finalPrompt: null, sent, architect: true }), ids)!;
    expect(designed).toMatchObject({ enhance: true });
    expect(designed).not.toHaveProperty('reviewedFrom');
    expect(rerunInput(video({ finalPrompt: null, sent: null, architect: false }), ids)).toMatchObject({ enhance: false });
  });
});

describe('designedSentence', () => {
  it('a shielded answer puts nothing in the bar; a plain one as before', () => {
    expect(designedSentence({ ok: true, source: 'model', shielded: true, token: 'x', pages: 1 } as never)).toBeNull();
    expect(designedSentence({ ok: true, prompt: '  A sentence  ', notes: '', source: 'model' })).toBe('A sentence');
  });
});
