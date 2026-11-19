import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { reshootLength } from '@/lib/brand-studio/revision/plan';
import { guardCredits, settleTalk, TALK_SYSTEM, type SettleInput, type TalkReading } from '@/lib/brand-studio/revision/talk';
import type { ReviseQuestion, ReviseSheet } from '@/lib/brand-studio/revision/sheet';
import { usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { geminiAnswer, mockGemini, sentBody } from '../intel/helpers';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRun } from './revision-helpers';

/**
 * `revise.talk` (lib/brand-studio/revision/talk.ts): the reading writes the reply and the sheet; the server
 * alone decides the way, the credits and whether "이대로 만들기" may exist.
 */

const sheet = (change: ReviseSheet['change'] = [], keep: string[] = [], exclude: string[] = []): ReviseSheet => ({ change, keep, exclude });
const look = (text: string) => ({ text, kind: 'look' as const });
const reading = (o: Partial<TalkReading> = {}): TalkReading => ({
  kind: 'change',
  reply: '배경을 바다로 바꿀게요. 병과 카메라 움직임은 그대로예요.',
  sheet: sheet([look('배경을 바다로')], ['병']),
  way: 'in_place',
  question: null,
  length: { action: 'none', seconds: null },
  impossible: false,
  ...o,
});
const terms: SettleInput['terms'] = {
  edit: { available: true, estimateKrw: 970 },
  reshoot: { available: true, estimateKrw: 810 },
  reshootAt: (s) => 162 * s,
  length: { current: 5, min: 4, max: 15, changeable: true },
};
const settle = (o: Partial<SettleInput> = {}) =>
  settleTalk({ reading: reading(), message: '배경을 바다로 바꿔줘', standing: { sheet: sheet(), questions: [] }, answering: null, terms, shown: null, ...o });
const question = (o: Partial<ReviseQuestion> = {}): ReviseQuestion => ({ point: 'background target', question: '어떤 배경으로 바꿀까요?', options: ['바다', '숲'], answer: null, ...o });

describe('settleTalk: the make button', () => {
  it('exists only for a standing sheet with a change and no open question', () => {
    expect(settle()).toMatchObject({ kind: 'change', canMake: true, way: 'edit', estimateKrw: 970 });
    expect(settle({ reading: reading({ sheet: sheet() }) })).toMatchObject({ canMake: false, way: null, estimateKrw: 0 });
    const asked = settle({ reading: reading({ question: { point: 'background target', text: '어떤 배경으로?', options: ['바다', '숲'] } }) });
    expect(asked).toMatchObject({ canMake: false, open: 0 });
  });

  it('never appears for a message that is not a request when nothing stands, whatever sheet the reading returns', () => {
    for (const kind of ['tool_question', 'unreadable', 'not_possible', 'confirm', 'withdraw'] as const) {
      const out = settle({ reading: reading({ kind }) });
      expect(out.canMake, kind).toBe(false);
      expect(out.sheet, kind).toEqual(sheet());
    }
  });

  it('keeps the standing plan (and its button) through a confirmation or a question about the tool', () => {
    const standing = { sheet: sheet([look('배경을 바다로')], ['병']), questions: [] };
    for (const kind of ['confirm', 'tool_question'] as const) {
      const out = settle({ standing, reading: reading({ kind, sheet: sheet([look('전혀 다른 것')]) }) });
      expect(out, kind).toMatchObject({ canMake: true, sheet: standing.sheet, way: 'edit' });
    }
    // "ㅇㅇ" with a plan standing is read as unreadable only if the reading says so: then no button for that turn.
    expect(settle({ standing, reading: reading({ kind: 'unreadable' }) }).canMake).toBe(false);
  });
});

describe('settleTalk: questions', () => {
  it('asks at most three in a conversation and never the same point twice', () => {
    const asked = [question({ point: 'a', answer: 'x' }), question({ point: 'b', answer: 'y' }), question({ point: 'c', answer: 'z' })];
    const fourth = settle({ standing: { sheet: sheet(), questions: asked }, reading: reading({ question: { point: 'd', text: '또?', options: ['1', '2'] } }) });
    expect(fourth.questions).toHaveLength(3);
    expect(fourth).toMatchObject({ open: null, canMake: true });
    const again = settle({ standing: { sheet: sheet(), questions: [question({ answer: '바다' })] }, reading: reading({ question: { point: 'Background-Target', text: '다시?', options: ['1', '2'] } }) });
    expect(again.questions).toHaveLength(1);
    expect(again.open).toBeNull();
  });

  it('pairs a typed answer with the open question, and a pressed choice or "decide for me" too', () => {
    const standing = { sheet: sheet(), questions: [question()] };
    const typed = settle({ standing, message: '눈 오는 서울 골목', reading: reading({ kind: 'answer', sheet: sheet([look('배경을 눈 오는 서울 골목으로')]) }) });
    expect(typed.questions[0]).toMatchObject({ answer: '눈 오는 서울 골목' });
    expect(typed).toMatchObject({ kind: 'answer', canMake: true });
    // The reading called the typed reply a change: still the answer, because the screen said it answers.
    const pressed = settle({ standing, message: '숲', answering: { option: 1 }, reading: reading({ kind: 'change' }) });
    expect(pressed.questions[0]).toMatchObject({ answer: '숲' });
    expect(pressed.kind).toBe('answer');
    const decided = settle({ standing, message: '알아서 정해 주세요', answering: { decide: true }, reading: reading({ kind: 'answer' }) });
    expect(decided.questions[0]).toMatchObject({ answer: '알아서 정해 주세요', decided: true });
  });

  it('marks an open question skipped when the customer goes on with something else, and never asks that point again', () => {
    const standing = { sheet: sheet(), questions: [question()] };
    const out = settle({ standing, message: '꽃잎도 빼줘', reading: reading({ kind: 'change', sheet: sheet([look('꽃잎 빼기')]), question: { point: 'background target', text: '배경은요?', options: ['바다', '숲'] } }) });
    expect(out.questions).toEqual([{ ...question(), skipped: true }]);
    expect(out).toMatchObject({ open: null, canMake: true });
  });

  it('turns an "answer" with no question open into a change', () => {
    expect(settle({ reading: reading({ kind: 'answer' }) }).kind).toBe('change');
  });
});

describe('settleTalk: a question turn is one message', () => {
  const ask = { point: 'background target', text: '배경을 어떤 곳으로 바꿀까요?', options: ['바다', '숲'] };
  it('is the question alone when nothing was settled, whatever the reply said', () => {
    const out = settle({ reading: reading({ sheet: sheet(), reply: '배경을 바꾸고 싶으시군요.', question: ask }) });
    expect(out.reply).toBe('배경을 어떤 곳으로 바꿀까요?');
    expect(out.dropped.parroting).toBe(true);
  });
  it('keeps one settled clause before the question, and never the question twice', () => {
    const out = settle({ reading: reading({ sheet: sheet([look('꽃잎 빼기')]), reply: '꽃잎은 뺄게요. 배경을 어떤 곳으로 바꿀까요?', question: ask }) });
    expect(out.reply).toBe('꽃잎은 뺄게요. 배경을 어떤 곳으로 바꿀까요?');
    const parroted = settle({ reading: reading({ sheet: sheet([look('꽃잎 빼기')]), reply: '색상을 변경해 드릴게요. 꽃잎은 뺄게요.', question: ask }) });
    expect(parroted.reply).toBe('꽃잎은 뺄게요. 배경을 어떤 곳으로 바꿀까요?');
  });
});

describe("settleTalk: the product is the brand's", () => {
  it('drops a product change the studio chose by itself, keeps one the customer asked for', () => {
    const chosen = settle({ reading: reading({ sheet: sheet([{ text: '병을 분홍색으로', kind: 'look', about: 'product', chosen: true }, { text: '배경을 베이지로', kind: 'look', about: 'scene', chosen: true }]) }) });
    expect(chosen.sheet.change.map((c) => c.text)).toEqual(['배경을 베이지로']);
    expect(chosen.dropped.productChoices).toBe(1);
    const asked = settle({ reading: reading({ sheet: sheet([{ text: '병을 분홍색으로', kind: 'look', about: 'product', chosen: false }]) }) });
    expect(asked.sheet.change).toHaveLength(1);
  });
  it('writes credits as a number with its unit', () => {
    expect(settle({ reading: reading({ reply: '처음부터 다시 만들며, 크레딧은 81이 들고 구도가 조금 달라질 수 있어요.' }) }).reply).toBe('처음부터 다시 만들며, 81크레딧이 들고 구도가 조금 달라질 수 있어요.');
  });
});

describe('settleTalk: withdrawal', () => {
  const standing = { sheet: sheet([look('배경을 바다로'), look('병을 더 크게')]), questions: [] };
  it('removes the last change when the reading did not, and takes a smaller sheet as it is', () => {
    expect(settle({ standing, reading: reading({ kind: 'withdraw', sheet: sheet([look('엉뚱한 것')]) }) }).sheet.change).toEqual([look('배경을 바다로')]);
    expect(settle({ standing, reading: reading({ kind: 'withdraw', sheet: sheet([look('병을 더 크게')]) }) }).sheet.change).toEqual([look('병을 더 크게')]);
  });
  it('has nothing to take back when nothing stands', () => {
    expect(settle({ reading: reading({ kind: 'withdraw', sheet: sheet() }) })).toMatchObject({ canMake: false, sheet: sheet() });
  });
});

describe('settleTalk: length is never booked as something else', () => {
  it('makes a longer clip again at its new length and price, within the model range', () => {
    const out = settle({ reading: reading({ sheet: sheet([{ text: '10초로 늘리기', kind: 'length', seconds: 10 }]), length: { action: 'longer', seconds: 10 } }) });
    expect(out).toMatchObject({ way: 'reshoot', seconds: 10, estimateKrw: 1620, canMake: true, impossible: false });
  });
  it('drops a shorter clip and points to the editing studio', () => {
    const out = settle({ reading: reading({ sheet: sheet([{ text: '4초로 줄이기', kind: 'length', seconds: 4 }]), length: { action: 'shorter', seconds: 4 } }) });
    expect(out).toMatchObject({ sheet: sheet(), canMake: false, editStudio: true });
    // Even when the reading only flags it.
    expect(settle({ reading: reading({ sheet: sheet(), length: { action: 'shorter', seconds: null } }) }).editStudio).toBe(true);
  });
  it('drops a length out of range or a length this clip cannot take, and says it is impossible', () => {
    expect(settle({ reading: reading({ sheet: sheet([{ text: '30초', kind: 'length', seconds: 30 }]) }) })).toMatchObject({ sheet: sheet(), canMake: false, impossible: true });
    const fixed = { ...terms, length: { ...terms.length, changeable: false } };
    expect(settle({ terms: fixed, reading: reading({ sheet: sheet([look('배경 바다'), { text: '10초', kind: 'length', seconds: 10 }]) }) })).toMatchObject({
      sheet: sheet([look('배경 바다')]),
      way: 'edit',
      impossible: true,
      canMake: true,
    });
  });
});

describe('settleTalk: failure and prices', () => {
  it('says nothing was read, keeps everything and offers no button', () => {
    const standing = { sheet: sheet([look('배경을 바다로')]), questions: [question()] };
    expect(settle({ standing, reading: null })).toMatchObject({ failed: true, kind: null, reply: null, sheet: standing.sheet, questions: standing.questions, open: 0, canMake: false });
  });
  it('reports a change of way or credits against what was shown', () => {
    const out = settle({ shown: { way: 'edit', estimateKrw: 970 }, reading: reading({ sheet: sheet([look('배경'), { text: '카메라 천천히', kind: 'motion' }]) }) });
    expect(out).toMatchObject({ way: 'reshoot', estimateKrw: 810, changed: { way: true, credits: true } });
    expect(settle({ shown: { way: 'edit', estimateKrw: 970 } }).changed).toEqual({ way: false, credits: false });
  });
  it('takes out a sentence that names a credit figure the facts never gave', () => {
    expect(guardCredits('바꿀게요. 120크레딧이 들어요. 아래 버튼을 눌러 주세요.', new Set([97]))).toBe('바꿀게요. 아래 버튼을 눌러 주세요.');
    expect(guardCredits('It takes 97 credits.', new Set([97]))).toBe('It takes 97 credits.');
  });
  it('makes again a look-only sheet when editing is closed', () => {
    const closed = { ...terms, edit: { available: false, estimateKrw: 0, problem: 'too_short' as const } };
    expect(settle({ terms: closed })).toMatchObject({ way: 'reshoot', estimateKrw: 810, canMake: true });
  });
});

describe('reshootLength: which remakes may take a new length', () => {
  const recipe = (kind: string, params: Record<string, unknown>) =>
    ({ recipeJob: { kind, model: 'seedance-2.5', params }, base: { seconds: 5 } }) as unknown as Parameters<typeof reshootLength>[0];
  it('a plain run and a blueprint remix: 4 to 15 s; an edit or a remix with its reference video: never', () => {
    expect(reshootLength(recipe('video', { seconds: 5 }))).toEqual({ current: 5, min: 4, max: 15, changeable: true });
    expect(reshootLength(recipe('video_remix', { method: 'blueprint', seconds: 6 })).changeable).toBe(true);
    expect(reshootLength(recipe('video_remix', { method: 'reference', seconds: 6 })).changeable).toBe(false);
    expect(reshootLength(recipe('video_remix', { method: 'reference', seconds: null })).changeable).toBe(false);
    expect(reshootLength({ recipeJob: null, base: { seconds: 5 } } as never)).toMatchObject({ current: 5, changeable: false });
  });
});

describe('revise.talk on the server', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const CLIP = {
    sheet: {
      seconds: 5, aspect: '16:9',
      shots: [{ start: 0, end: 5, framing: 'close-up', camera: 'slow push in', action: 'a perfume bottle stands on petals' }],
      look: { lighting: 'soft light from the left', palette: 'blue and white', texture: 'clean' },
      audio: { music: false, speech: false, effects: '' },
      summary: '5초, 컷 하나.',
    },
    inventory: {
      people: 0, peopleNote: '', product: 'a heart-shaped perfume bottle', productColours: 'blue liquid, clear glass, silver cap', mark: 'white lettering on the front',
      background: 'a pale oval mirror', light: 'soft, from the left', music: false, speech: false, textOnScreen: '',
    },
  };
  const depsWith = (answer: unknown, flag = true) => {
    const fetchMock = mockGemini(answer);
    const clipReads = { n: 0 };
    const deps = studioDeps(f.sql, {
      env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...(flag ? { BRAND_STUDIO_REVISE_V2: 'on' } : {}) }),
      intelDeps: { fetch: fetchMock as unknown as typeof fetch, env: { GEMINI_API_KEY: 'test-key' } },
      readClip: async () => {
        clipReads.n += 1;
        return CLIP;
      },
    } as never);
    return { deps, fetchMock, clipReads };
  };
  const talk = (deps: ReturnType<typeof studioDeps>, input: Record<string, unknown>) =>
    runStudioOperation(deps, viewerOf(f.ids.owner), 'revise.talk', { organizationId: f.orgId, ...input });

  it('is invalid with the flag off and never reads anything', async () => {
    const { deps, fetchMock, clipReads } = depsWith(reading(), false);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    expect(await talk(deps, { outputId: root.outputId, message: '배경을 바다로' })).toEqual({ ok: false, code: 'invalid' });
    expect(await talk(deps, { outputId: root.outputId })).toEqual({ ok: false, code: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clipReads.n).toBe(0);
  });

  it('reads the clip once on the opening call, keeps it on the job, and talks with it afterwards', async () => {
    const { deps, fetchMock, clipReads } = depsWith(reading());
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A blue perfume bottle.', params: { seconds: 5, resolution: 'draft' }, seconds: 5, isDraft: true });
    const opening = await talk(deps, { outputId: root.outputId });
    expect(opening).toMatchObject({ ok: true, kind: null, reply: null, canMake: false, clipKnown: true, version: 2 });
    expect(clipReads.n).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const kept = (await f.sql.query<{ params: { clipSheets?: Record<string, unknown> } }>('select params from brand_studio_jobs where id = $1', [root.jobId])).rows[0]!;
    expect(Object.keys(kept.params.clipSheets ?? {})).toEqual([`${root.outputId}:ko:v2`]);

    const turn = await talk(deps, {
      outputId: root.outputId,
      message: '배경을 바다로 바꿔줘',
      turns: [{ role: 'customer', text: '안녕' }, { role: 'studio', text: '무엇을 바꿀까요?' }],
    });
    expect(turn).toMatchObject({ ok: true, kind: 'change', canMake: true, way: 'edit', clipKnown: true, sheet: { change: [look('배경을 바다로')] } });
    expect(clipReads.n).toBe(1);
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).toBe(TALK_SYSTEM);
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'LOW' } });
    const payload = JSON.parse((body.contents[0]!.parts[0] as { text: string }).text);
    expect(payload.conversation).toEqual([
      { from: 'customer', text: '안녕' },
      { from: 'studio', text: '무엇을 바꿀까요?' },
      { from: 'customer', text: '배경을 바다로 바꿔줘' },
    ]);
    expect(payload.clip).toMatchObject({ seconds: 5, shots: [{ action: 'a perfume bottle stands on petals' }], inventory: { people: 0, mark: 'white lettering on the front' } });
    expect(payload.madeWith).toBe('A blue perfume bottle.');
    expect(payload.facts).toMatchObject({ this_clip: 'draft', length: { current_seconds: 5, can_lengthen: true, max_seconds: 15 } });
    expect(payload.questionsLeft).toBe(3);
  });

  it('tries the reading twice, then answers failed with no button', async () => {
    const { deps, fetchMock } = depsWith(() => new Response('nope', { status: 500 }));
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const out = await talk(deps, { outputId: root.outputId, message: '배경을 바다로', sheet: sheet([look('꽃잎 빼기')]) });
    expect(out).toMatchObject({ ok: true, failed: true, kind: null, reply: null, canMake: false, sheet: sheet([look('꽃잎 빼기')]) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a second try that works answers normally', async () => {
    let n = 0;
    const { deps, fetchMock } = depsWith(() => (n++ === 0 ? new Response('busy', { status: 503 }) : geminiAnswer(reading())));
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    expect(await talk(deps, { outputId: root.outputId, message: '배경을 바다로' })).toMatchObject({ ok: true, kind: 'change', canMake: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once, told why, when the studio changed the product by its own choice; then takes the slip out', async () => {
    const slip = reading({ sheet: sheet([{ text: '병을 분홍색으로', kind: 'look', about: 'product', chosen: true }]) });
    const { deps, fetchMock } = depsWith(slip);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const out = await talk(deps, { outputId: root.outputId, message: '아무 색이나' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((sentBody(fetchMock, 1).contents[0]!.parts[0] as { text: string }).text).correction).toContain('about');
    // The second answer slipped too: the change is dropped, and nothing is offered for it.
    expect(out).toMatchObject({ ok: true, canMake: false, sheet: sheet() });
  });

  it('taking back a line also takes back what it put into "leave out"', async () => {
    const { deps } = depsWith(reading());
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const standing = sheet([look('배경을 바다로'), look('꽃잎 빼기')], ['병'], ['꽃잎']);
    expect(await talk(deps, { outputId: root.outputId, sheet: standing, remove: 1 })).toMatchObject({ sheet: { change: [look('배경을 바다로')], keep: ['병'], exclude: [] } });
  });

  it('opening calls on a clip already read take no slot of the per-minute cap', async () => {
    const { deps, clipReads } = depsWith(reading());
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    for (let i = 0; i < 25; i += 1) expect(await talk(deps, { outputId: root.outputId })).toMatchObject({ ok: true });
    expect(clipReads.n).toBe(1);
    expect(await talk(deps, { outputId: root.outputId, message: '배경을 바다로' })).toMatchObject({ ok: true, kind: 'change' });
  });

  it('takes a line out with its remove control, without reading anything', async () => {
    const { deps, fetchMock } = depsWith(reading());
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const standing = sheet([look('배경을 바다로'), { text: '카메라를 더 천천히', kind: 'motion' }]);
    const out = await talk(deps, { outputId: root.outputId, sheet: standing, remove: 1, shown: { way: 'reshoot', estimateKrw: 1 } });
    expect(out).toMatchObject({ ok: true, kind: 'withdraw', reply: null, sheet: { change: [look('배경을 바다로')] }, way: 'edit', canMake: true, changed: { way: true } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await talk(deps, { outputId: root.outputId, sheet: standing, remove: 4 })).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('job.create from the conversation', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const depsFor = (flag: boolean) =>
    studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...(flag ? { BRAND_STUDIO_REVISE_V2: 'on' } : {}) }) });
  const dialogue = (s: ReviseSheet) => ({
    sheet: s,
    questions: [{ point: 'background target', question: '어떤 배경?', options: ['바다', '숲'], answer: '바다' }],
    transcript: [{ role: 'customer', text: '배경 바꿔줘' }, { role: 'studio', text: '어떤 배경으로 바꿀까요?' }, { role: 'customer', text: '바다' }],
  });
  const create = (deps: ReturnType<typeof studioDeps>, input: Record<string, unknown>) =>
    runStudioOperation(deps, viewerOf(f.ids.owner), 'job.create', { kind: 'video_revise', organizationId: f.orgId, requestId: crypto.randomUUID(), ...input });
  const row = async (id: string) => (await f.sql.query<{ prompt: string; params: Record<string, any>; estimate_krw: number }>('select prompt, params, estimate_krw from brand_studio_jobs where id = $1', [id])).rows[0]!;

  it('ignores the record entirely with the flag off: same job as without it', async () => {
    const deps = depsFor(false);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const plain = await create(deps, { outputId: root.outputId, mode: 'edit', prompt: '배경을 바다로' });
    const withRecord = await create(deps, { outputId: root.outputId, mode: 'edit', prompt: '배경을 바다로', dialogue: { anything: 'goes' } });
    if (!plain.ok || !withRecord.ok) throw new Error('create failed');
    const [a, b] = [await row((plain as any).job.id), await row((withRecord as any).job.id)];
    expect(b.prompt).toBe(a.prompt);
    expect(b.params.revision.dialogue).toBeUndefined();
    const strip = (p: Record<string, any>) => ({ ...p, revision: { ...p.revision, version: 0 } });
    expect(strip(b.params)).toEqual(strip(a.params));
  });

  it('makes the sheet the request, keeps the record, and follows the sheet for the way', async () => {
    const deps = depsFor(true);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5 }, seconds: 5 });
    const s = sheet([look('배경을 바다로')], ['병', '카메라 움직임']);
    expect(await create(deps, { outputId: root.outputId, mode: 'reshoot', prompt: 'x', dialogue: dialogue(s) })).toEqual({ ok: false, code: 'invalid' });
    const made = await create(deps, { outputId: root.outputId, mode: 'edit', prompt: 'x', dialogue: dialogue(s) });
    if (!made.ok) throw new Error('create failed');
    const job = await row((made as any).job.id);
    expect(job.prompt).toBe('배경을 바다로');
    expect(job.params.revision.dialogue).toMatchObject({ sheet: s, questions: [{ answer: '바다' }] });
    expect(job.params.revision.dialogue.transcript).toHaveLength(3);
    expect(await create(deps, { outputId: root.outputId, mode: 'edit', prompt: 'x', dialogue: { sheet: 'bad' } })).toEqual({ ok: false, code: 'invalid' });
  });

  it('books a longer clip as a remake of that length and price, and refuses to book it any other way', async () => {
    const deps = depsFor(true);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 5, resolution: '720p' }, seconds: 5 });
    const longer = sheet([{ text: '10초로 늘리기', kind: 'length', seconds: 10 }]);
    expect(await create(deps, { outputId: root.outputId, mode: 'edit', prompt: 'x', dialogue: dialogue(longer) })).toEqual({ ok: false, code: 'invalid' });
    const made = await create(deps, { outputId: root.outputId, mode: 'reshoot', prompt: 'x', dialogue: dialogue(longer) });
    if (!made.ok) throw new Error('create failed');
    const job = await row((made as any).job.id);
    expect(job.params.seconds).toBe(10);
    expect(job.estimate_krw).toBe(usageKrw(videoRunUsd({ resolution: '720p', seconds: 10 }), 'video'));
    const tooLong = sheet([{ text: '30초로', kind: 'length', seconds: 30 }]);
    expect(await create(deps, { outputId: root.outputId, mode: 'reshoot', prompt: 'x', dialogue: dialogue(tooLong) })).toEqual({ ok: false, code: 'invalid' });
    // A shorter (or the same) length is never booked: cutting belongs to the editing studio.
    for (const seconds of [4, 5]) {
      const shorter = sheet([{ text: `${seconds}초로`, kind: 'length', seconds }]);
      expect(await create(deps, { outputId: root.outputId, mode: 'reshoot', prompt: 'x', dialogue: dialogue(shorter) })).toEqual({ ok: false, code: 'invalid' });
    }
  });
});
