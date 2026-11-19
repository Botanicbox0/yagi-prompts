import { describe, expect, it, vi } from 'vitest';
import type { StudioReviseTalk } from '@/lib/brand-studio/contracts';
import { createTalkFlow, type TalkDeps } from '@/components/brand-studio/revise-talk-flow';
import { browserTalkStore, memoryTalkStore, savedTalkOutputs } from '@/components/brand-studio/revise-talk-store';

/** The revise conversation on screen (components/brand-studio/revise-talk-flow.ts), without a DOM. */

const ORG = '00000000-0000-4000-8000-000000000001';
const OUT = '00000000-0000-4000-8000-000000000002';
const look = (text: string) => ({ text, kind: 'look' as const });
const answer = (o: Partial<StudioReviseTalk> = {}): StudioReviseTalk => ({
  ok: true,
  version: 2,
  kind: 'change',
  reply: '배경을 바다로 바꿀게요. 병은 그대로 둘게요.',
  sheet: { change: [look('배경을 바다로')], keep: ['병'], exclude: [] },
  questions: [],
  open: null,
  way: 'edit',
  estimateKrw: 970,
  seconds: null,
  canMake: true,
  impossible: false,
  editStudio: false,
  changed: { way: false, credits: false },
  clipKnown: true,
  ...o,
});
const opening = (o: Partial<StudioReviseTalk> = {}) => answer({ kind: null, reply: null, sheet: { change: [], keep: [], exclude: [] }, way: null, estimateKrw: 0, canMake: false, ...o });

function harness(replies: Array<StudioReviseTalk | { ok: false; code: 'failed' }>) {
  const store = memoryTalkStore();
  const timers: Array<() => void> = [];
  const talk = vi.fn(async () => replies.shift() ?? opening());
  const create = vi.fn(async () => ({ ok: true as const, job: { id: 'job' } as never }));
  const onCreated = vi.fn();
  const deps: TalkDeps = {
    organizationId: ORG,
    outputId: OUT,
    talk: talk as unknown as TalkDeps['talk'],
    create: create as unknown as TalkDeps['create'],
    store,
    onChange: () => undefined,
    onCreated,
    decideText: '알아서 정해 주세요',
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  };
  return { flow: createTalkFlow(deps), talk, create, store, timers, onCreated };
}

describe('the revise conversation on screen', () => {
  it('sends what is typed, shows the studio message, keeps one sheet and the button only when the server says so', async () => {
    const h = harness([opening(), answer()]);
    await h.flow.load();
    expect(h.flow.state).toMatchObject({ phase: 'idle', canMake: false, clipKnown: true });
    h.flow.setDraft('배경을 바다로 바꿔줘');
    await h.flow.send();
    expect(h.flow.state.thread.map((t) => t.from)).toEqual(['customer', 'studio']);
    expect(h.flow.state).toMatchObject({ phase: 'idle', canMake: true, way: 'edit', draft: '', fresh: ['배경을 바다로'] });
    expect(h.talk).toHaveBeenLastCalledWith(expect.objectContaining({ message: '배경을 바다로 바꿔줘', turns: [], shown: null }));
  });

  it('restores the kept conversation, and a message cut off by a reload comes back with "send again"', async () => {
    const first = harness([opening(), answer()]);
    await first.flow.load();
    first.flow.setDraft('배경을 바다로 바꿔줘');
    await first.flow.send();
    first.flow.setDraft('아직 안 보낸 말');
    const kept = first.store.value!;
    expect(kept.thread).toHaveLength(2);
    expect(kept.draft).toBe('아직 안 보낸 말');

    const again = harness([opening({ sheet: kept.sheet, way: 'edit', estimateKrw: 970, canMake: true })]);
    again.store.value = kept;
    await again.flow.load();
    expect(again.flow.state).toMatchObject({ phase: 'idle', draft: '아직 안 보낸 말', canMake: true });
    expect(again.flow.state.thread).toHaveLength(2);
    expect(again.talk).toHaveBeenCalledWith(expect.objectContaining({ sheet: kept.sheet }));

    const cut = harness([opening()]);
    cut.store.value = { ...kept, thread: [...kept.thread, { id: 'x', from: 'customer', text: '꽃잎도 빼줘', references: [], materials: [], marks: [] }], pending: { text: '꽃잎도 빼줘' } };
    await cut.flow.load();
    expect(cut.flow.state.phase).toBe('failed');
    expect(cut.flow.state.thread.at(-1)).toMatchObject({ from: 'note', note: 'failed' });
  });

  it('pairs a chosen option, "decide for me" and a typed reply with the open question', async () => {
    const asked = answer({ reply: '배경을 어떤 곳으로 바꿀까요?', sheet: { change: [], keep: [], exclude: [] }, questions: [{ point: 'bg', question: '배경을 어떤 곳으로 바꿀까요?', options: ['바다', '숲'], answer: null }], open: 0, canMake: false, way: null });
    const h = harness([opening(), asked, answer()]);
    await h.flow.load();
    h.flow.setDraft('배경 바꿔줘');
    await h.flow.send();
    expect(h.flow.state.thread.at(-1)).toMatchObject({ from: 'studio', question: 0 });
    await h.flow.choose(1);
    expect(h.flow.state.thread.at(-2)).toMatchObject({ from: 'customer', text: '숲', answers: 0 });
    expect(h.talk).toHaveBeenLastCalledWith(expect.objectContaining({ message: '숲', answering: { option: 1 } }));

    const d = harness([opening(), asked, answer()]);
    await d.flow.load();
    d.flow.setDraft('배경 바꿔줘');
    await d.flow.send();
    await d.flow.choose('decide');
    expect(d.talk).toHaveBeenLastCalledWith(expect.objectContaining({ message: '알아서 정해 주세요', answering: { decide: true } }));

    const t = harness([opening(), asked, answer()]);
    await t.flow.load();
    t.flow.setDraft('배경 바꿔줘');
    await t.flow.send();
    t.flow.setDraft('눈 오는 서울 골목');
    await t.flow.send();
    expect(t.flow.state.thread.at(-2)).toMatchObject({ from: 'customer', text: '눈 오는 서울 골목', answers: 0 });
  });

  it('says a failed reading out loud, offers no button, and sends the same message again', async () => {
    const h = harness([opening(), answer({ failed: true, kind: null, reply: null, canMake: false }), answer()]);
    await h.flow.load();
    h.flow.setDraft('배경을 바다로 바꿔줘');
    await h.flow.send();
    expect(h.flow.state).toMatchObject({ phase: 'failed', canMake: false, pending: { text: '배경을 바다로 바꿔줘' } });
    expect(h.flow.state.thread.at(-1)).toMatchObject({ from: 'note', note: 'failed' });
    await h.flow.resend();
    expect(h.flow.state).toMatchObject({ phase: 'idle', canMake: true, pending: null });
    expect(h.flow.state.thread.map((t) => t.from)).toEqual(['customer', 'studio']);
    expect(h.talk).toHaveBeenLastCalledWith(expect.objectContaining({ message: '배경을 바다로 바꿔줘' }));
  });

  it('turns to "taking a little longer" after 8 s', async () => {
    let release: (v: StudioReviseTalk) => void = () => undefined;
    const h = harness([opening()]);
    await h.flow.load();
    h.talk.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    h.flow.setDraft('배경을 바다로');
    const sending = h.flow.send();
    expect(h.flow.state.phase).toBe('reading');
    h.timers.at(-1)!();
    expect(h.flow.state.phase).toBe('slow');
    release(answer());
    await sending;
    expect(h.flow.state.phase).toBe('idle');
  });

  it('removes a line with its control: the server settles it, nothing is read', async () => {
    const two = answer({ sheet: { change: [look('배경을 바다로'), look('꽃잎 빼기')], keep: [], exclude: [] } });
    const h = harness([opening(), two, answer({ kind: 'withdraw', reply: null })]);
    await h.flow.load();
    h.flow.setDraft('배경 바다, 꽃잎 빼기');
    await h.flow.send();
    await h.flow.remove(1);
    expect(h.talk).toHaveBeenLastCalledWith(expect.objectContaining({ remove: 1 }));
    expect((h.talk.mock.lastCall as unknown as [Record<string, unknown>])[0]).not.toHaveProperty('message');
    expect(h.flow.state.sheet.change).toEqual([look('배경을 바다로')]);
    expect(h.flow.state.thread.at(-1)).toMatchObject({ from: 'note', note: 'removed', text: '꽃잎 빼기' });
  });

  it('makes the version from the sheet, clears what was kept and hands the new version to the viewer', async () => {
    const h = harness([opening(), answer()]);
    await h.flow.load();
    h.flow.setDraft('배경을 바다로 바꿔줘');
    await h.flow.send();
    await h.flow.make();
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'video_revise',
        mode: 'edit',
        prompt: '배경을 바다로',
        dialogue: expect.objectContaining({ sheet: expect.objectContaining({ change: [look('배경을 바다로')] }), transcript: [{ role: 'customer', text: '배경을 바다로 바꿔줘' }, { role: 'studio', text: '배경을 바다로 바꿀게요. 병은 그대로 둘게요.' }] }),
      }),
    );
    expect(h.store.value).toBeNull();
    expect(h.onCreated).toHaveBeenCalledWith(expect.anything(), 2, expect.objectContaining({ change: [look('배경을 바다로')] }));
    expect(h.flow.state.phase).toBe('making');
  });

  it('a second opening call that answers after a message was sent leaves the conversation alone', async () => {
    let releaseOpening: (v: StudioReviseTalk) => void = () => undefined;
    const h = harness([opening()]);
    await h.flow.load();
    h.talk.mockImplementationOnce(() => new Promise((resolve) => (releaseOpening = resolve)));
    const late = h.flow.load();
    // The first load already finished; the customer types and sends while the second is on its way.
    h.talk.mockImplementationOnce(async () => answer());
    releaseOpening(opening({ version: 3 }));
    await late;
    h.flow.setDraft('배경을 바다로');
    await h.flow.send();
    expect(h.flow.state).toMatchObject({ phase: 'idle', canMake: true });
    expect(h.flow.state.thread.map((t) => t.from)).toEqual(['customer', 'studio']);
  });

  it('starts over: the conversation and what was kept are gone', async () => {
    const h = harness([opening(), answer()]);
    await h.flow.load();
    h.flow.setDraft('배경을 바다로 바꿔줘');
    await h.flow.send();
    h.flow.startOver();
    expect(h.flow.state).toMatchObject({ thread: [], canMake: false, phase: 'idle' });
    expect(h.store.value).toBeNull();
  });
});

describe('the conversations kept in this browser (the version row dots)', () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
  };
  const saved = (said: boolean) => ({
    thread: said ? [{ id: 'a', from: 'customer' as const, text: '배경 바꿔줘', references: [], materials: [], marks: [] }] : [],
    sheet: { change: [], keep: [], exclude: [] },
    questions: [], open: null, way: null, estimateKrw: 0, seconds: null, canMake: false, editStudio: false, draft: said ? '' : '바다', references: [], materials: [], marks: [], pending: null,
  });
  it('are the results with something said and not made yet; blocked storage is none', () => {
    const before = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { localStorage: memory() };
    try {
      const A = '00000000-0000-4000-8000-00000000000a';
      const B = '00000000-0000-4000-8000-00000000000b';
      const C = '00000000-0000-4000-8000-00000000000c';
      browserTalkStore(ORG, A).save(saved(true));
      browserTalkStore(ORG, B).save(saved(false)); // only a draft typed: no dot
      expect([...savedTalkOutputs(ORG, [A, B, C])]).toEqual([A]);
      browserTalkStore(ORG, A).clear(); // made into a version
      expect(savedTalkOutputs(ORG, [A, B, C]).size).toBe(0);
      (globalThis as { window?: unknown }).window = { get localStorage(): Storage { throw new Error('blocked'); } };
      expect(savedTalkOutputs(ORG, [A]).size).toBe(0);
    } finally {
      (globalThis as { window?: unknown }).window = before;
    }
  });
});
