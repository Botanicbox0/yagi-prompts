/**
 * Review finding 3: a finished device upload (A8) gives the timeline new objects in every history step that
 * holds the device cut, and "말로 편집" compares timelines by identity (a patch answer's base, history marks).
 * An adoption only changes where a file plays from, so the assistant must not see it: an answer that arrives
 * after the upload landed still applies, and applied entries keep their place in the history.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRecent,
  decideAssist,
  draftFrom,
  markState,
  settleUndone,
  type AssistEntry,
  type HistoryView,
} from '@/components/brand-studio/compose/assist/assist-model';
import { commitHistory, initHistory, mapHistory, redoHistory, undoHistory, type History } from '@/components/brand-studio/compose/history';
import {
  adoptDeviceUpload,
  adoptDeviceUploads,
  composeSourceUrl,
  sameTimeline,
  type DeviceUploadAdoption,
} from '@/lib/brand-studio/compose/device-files';
import { appendClip, applyTimelinePatches, emptyComposerProject, type ComposerProject } from '@/lib/brand-studio/compose/timeline';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ASSET = '40000000-0000-4000-8000-000000000001';
const BLOB = 'blob:http://localhost:3634/7c1d0e2a-0000-4000-8000-000000000001';
const adoption: DeviceUploadAdoption = { assetId: ASSET, srcUrl: composeSourceUrl(ORG, 'asset', ASSET), thumbUrl: null };

function film(): ComposerProject {
  let p = emptyComposerProject('9:16');
  p = appendClip(p, { id: 'lib', label: 'library', sourceKind: 'asset', assetId: '40000000-0000-4000-8000-000000000002', srcUrl: composeSourceUrl(ORG, 'asset', '40000000-0000-4000-8000-000000000002'), durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false });
  p = appendClip(p, { id: 'dev', label: 'device', sourceKind: 'local', srcUrl: BLOB, thumbUrl: null, durationSec: 8, trimStartSec: 0, trimEndSec: 8, volume: 1, muted: false });
  return p;
}

const viewOf = (h: History<ComposerProject>): HistoryView => ({ current: h.present, undo: h.past, redo: h.future });
const adopt = (h: History<ComposerProject>) => mapHistory(h, (p) => adoptDeviceUpload(p, BLOB, adoption));

describe('an adoption is invisible to "말로 편집"', () => {
  it('an answer that arrives after the upload landed still applies (patches made for the timeline that was sent)', () => {
    const sent = film();
    const real = adoptDeviceUpload(sent, BLOB, adoption);
    expect(real).not.toBe(sent);
    expect(sameTimeline(sent, real)).toBe(true);
    const answer = { ok: true as const, kind: 'patches' as const, patches: [{ op: 'trim_clip' as const, clipIndex: 1, trimStartSec: 1 }] };
    const decision = decideAssist(real, answer, sent);
    expect(decision.type === 'instant' || decision.type === 'proposal').toBe(true);
    if (decision.type !== 'instant' && decision.type !== 'proposal') return;
    // Built on the timeline as it is now: the cut already plays the asset.
    const cut = decision.draft.clips.find((c) => c.id === 'dev')!;
    expect(cut).toMatchObject({ sourceKind: 'asset', assetId: ASSET, srcUrl: adoption.srcUrl, trimStartSec: 1 });
    // An open proposal is applied by rebuilding from the real timeline: not refused either.
    expect(draftFrom(real, decision.source).type).toBe('draft');
  });

  it('a timeline someone did edit in the meantime is still stale', () => {
    const sent = film();
    const edited = applyTimelinePatches(adoptDeviceUpload(sent, BLOB, adoption), [{ op: 'remove_clip', clipIndex: 0 }]).project;
    expect(sameTimeline(sent, edited)).toBe(false);
    expect(draftFrom(edited, { kind: 'patches', patches: [{ op: 'trim_clip', clipIndex: 0, trimStartSec: 1 }], base: sent })).toEqual({ type: 'stale' });
    expect(sameTimeline(film(), film())).toBe(false);
  });

  it('marks keep their state across an adoption: top, undone, and back to top on redo', () => {
    const start = film();
    const mark = applyTimelinePatches(start, [{ op: 'trim_clip', clipIndex: 1, trimEndSec: 6 }]).project;
    let h = commitHistory(initHistory(start), mark);
    const entry: AssistEntry = { id: 'a1', type: 'applied', deltas: [], historyMark: mark, undone: false };

    h = adopt(h);
    expect(h.present).not.toBe(mark);
    expect(markState(mark, viewOf(h))).toBe('top');
    expect(buildRecent([{ id: 'u1', type: 'user', text: '끝 2초 잘라 줘' }, entry], () => 'x', viewOf(h))[0]!.kept).toBe(true);

    // Undone before the upload lands, redone after.
    let u = undoHistory(commitHistory(initHistory(start), mark));
    expect(markState(mark, viewOf(u))).toBe('undone');
    let entries = settleUndone([entry], viewOf(u));
    expect(entries[0]).toMatchObject({ undone: true });
    u = adopt(u);
    expect(markState(mark, viewOf(u))).toBe('undone');
    u = redoHistory(u);
    expect(u.present.clips.find((c) => c.id === 'dev')!.assetId).toBe(ASSET);
    expect(markState(mark, viewOf(u))).toBe('top');
    entries = settleUndone(entries, viewOf(u));
    expect(entries[0]).toMatchObject({ undone: false });

    // Buried under a later edit, after an adoption.
    const later = commitHistory(u, applyTimelinePatches(u.present, [{ op: 'remove_clip', clipIndex: 0 }]).project);
    expect(markState(mark, viewOf(later))).toBe('buried');
  });

  it('an instant edit committed with the finished uploads applied keeps its mark on top', () => {
    const sent = film();
    const draft = applyTimelinePatches(sent, [{ op: 'set_clip_audio', clipIndex: 1, muted: true }]).project;
    // The composer commits `adoptDeviceUploads(draft)` when the upload landed before the commit.
    const committed = adoptDeviceUploads(draft, new Map([[BLOB, adoption]]));
    expect(committed).not.toBe(draft);
    const h = commitHistory(initHistory(sent), committed);
    expect(markState(draft, viewOf(h))).toBe('top');
  });
});
