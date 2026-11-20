import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  checkLyrics,
  defaultStructure,
  markLyrics,
  ownLyrics,
  structureMarks,
  tempoOf,
  withoutAddedLines,
  type LyricCheckInput,
} from '@/lib/brand-studio/sound/lyrics';
import { draftProblems, localLyrics, lyricsTask, STANZAS, type LyricsRequest } from '@/lib/brand-studio/sound/lyrics-draft';
import { isLyricsModel, LYRICS_DEFAULT_MODEL, LYRICS_MODELS, lyricsModelOf } from '@/lib/brand-studio/sound/lyrics-model';
import { musicTracks } from '@/lib/brand-studio/sound/library';
import { planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Sound studio slice SA2 (docs/BRAND-SOUND-STUDIO.md §12.3, §12.6): the lyrics engine. The customer's own lyrics
 * go byte for byte (only marks are added, in the chosen structure; a closing `[End]` waits for the founder, §12.8 b), the checks without a model, the
 * two flows a model writes (topic, polish) with one rewrite, the lyrics model as a checked server setting, and
 * the run's record of who wrote its lyrics.
 */
const ORG = '00000000-0000-4000-8000-0000000000ef';

const CUSTOMER_TEXTS = [
  '아침 햇살이 창을 두드리면\n물 한 잔으로 하루를 열어요\n\n오늘도 맑게',
  '  들여 쓴 줄도 그대로  \n마침표까지.\n\n\n\n빈 줄 여러 개 뒤의 절!',
  'Hey, 에코핀 🌿\r\n이모지와 CRLF\r\n\r\n(oh) 추임새',
  '한 절뿐인 가사',
  '[Verse]\n내가 직접 쓴 표시\n\n[Chorus]\n그대로 둔다\n[End]',
];

describe('내 가사 그대로: the customer’s lines go byte for byte', () => {
  it('adds only mark lines (no [End] while it waits for the founder); removing them gives the customer’s text back', () => {
    for (const text of CUSTOMER_TEXTS) {
      for (const structure of [null, 'hook', 'hook-verse', 'full'] as const) {
        const marked = markLyrics(text, structure);
        expect(withoutAddedLines(marked, text)).toBe(ownLyrics(text));
        expect(marked.match(/^\[End\]$/gm) ?? []).toHaveLength(/^\[End\]$/m.test(text) ? 1 : 0);
        // Every line the customer wrote is there, in order, unchanged (byte compare on the UTF-8).
        const own = ownLyrics(text).split('\n');
        const kept = marked.split('\n').filter((line) => own.includes(line));
        expect(Buffer.from(kept.join('\n'), 'utf8').equals(Buffer.from(own.join('\n'), 'utf8'))).toBe(true);
      }
    }
  });

  it('sends the raw text untouched through the real adapter: first-line spaces, own marks, NBSP and U+3000 kept (review 1)', () => {
    const base = { kind: 'music' as const, organizationId: ORG, requestId: 'req_12345678', prompt: '밝은 팝', vocal: true, architect: false };
    const raws = [
      '\n\n   [Verse]\n  첫 줄 앞 공백\n둘째 줄\u00a0\n\n[Chorus]\n후렴\u3000\n\n\n',
      '  첫 줄 앞 공백.\r\n둘째 줄!\u00a0\r\n\r\n마지막 줄\u3000',
    ];
    for (const raw of raws) {
      for (const structure of [undefined, 'hook', 'full'] as const) {
        const plan = planMusic({ ...base, lyrics: raw, ...(structure ? { structure } : {}) }, 'ko');
        const sent = (plan.engine.request(plan.request).body as { lyrics: string }).lyrics;
        const kept = raw.replace(/\r\n?/g, '\n').split('\n');
        const first = kept.findIndex((l) => l.trim() !== '');
        let last = kept.length - 1;
        while (kept[last]!.trim() === '') last -= 1;
        const expected = kept.slice(first, last + 1).join('\n');
        expect(ownLyrics(raw)).toBe(expected);
        expect(Buffer.from(withoutAddedLines(sent, raw), 'utf8').equals(Buffer.from(expected, 'utf8'))).toBe(true);
      }
    }
    // The customer's own marks: what is sent is exactly their text (nothing added while the ending waits).
    const own = planMusic({ ...base, lyrics: raws[0]! }, 'ko');
    expect((own.engine.request(own.request).body as { lyrics: string }).lyrics).toBe('   [Verse]\n  첫 줄 앞 공백\n둘째 줄\u00a0\n\n[Chorus]\n후렴\u3000');
  });

  it('marks the stanzas in the order of the chosen structure, the last one [Outro]', () => {
    const four = 'a\n\nb\n\nc\n\nd';
    expect(markLyrics(four, 'hook')).toBe('[Chorus]\na\n\n[Chorus]\nb\n\n[Chorus]\nc\n\n[Outro]\nd');
    expect(markLyrics(four, 'hook-verse')).toBe('[Chorus]\na\n\n[Verse]\nb\n\n[Chorus]\nc\n\n[Outro]\nd');
    expect(markLyrics(four, 'full')).toBe('[Verse 1]\na\n\n[Chorus]\nb\n\n[Verse 2]\nc\n\n[Outro]\nd');
    expect(markLyrics('혼자', 'hook')).toBe('[Chorus]\n혼자');
    expect(structureMarks('full', 5)).toEqual(['[Verse 1]', '[Chorus]', '[Verse 2]', '[Chorus]', '[Outro]']);
    expect(markLyrics(' \n\n ', 'hook')).toBe('');
  });

  it('starts short ads on the hook (§12.3 "짧은 광고 음악")', () => {
    expect(defaultStructure(15)).toBe('hook');
    expect(defaultStructure(30)).toBe('hook');
    expect(defaultStructure(60)).toBe('hook-verse');
    expect(defaultStructure(null)).toBe('full');
    // Length is lines now (§12.11, tests/brand-studio/sound/length-plan.test.ts): the tempo words still read.
    expect(tempoOf('레몬 탄산수 광고, 상쾌하고 가볍게')).toBe(120);
    expect(tempoOf('밝은 팝, 112 BPM')).toBe(112);
    expect(tempoOf('신나는 댄스')).toBe(120);
    expect(tempoOf('잔잔한 발라드')).toBe(80);
    expect(tempoOf('아침 광고')).toBeNull();
  });

  it('sends the customer’s lyrics marked by the structure, and the run keeps them as written', () => {
    const lyrics = '  햇살 같은 하루.\n\n같이 걸어요!';
    const plan = planMusic(
      { kind: 'music', organizationId: ORG, requestId: 'req_12345678', prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics, structure: 'hook', architect: false },
      'ko',
    );
    const body = plan.engine.request(plan.request).body as { lyrics: string };
    expect(body.lyrics).toBe('[Chorus]\n  햇살 같은 하루.\n\n[Outro]\n같이 걸어요!');
    expect(plan.params.music).toMatchObject({ lyrics, structure: 'hook', lyricsBy: { flow: 'own', model: null } });
  });
});

describe('checks without a model', () => {
  const base = (over: Partial<LyricCheckInput> = {}): LyricCheckInput => ({ lyrics: '', language: 'ko', stanzaLines: null, tone: null, brand: null, mustInclude: [], ...over });

  it('hard: brackets other than marks, long parentheses, superlatives, missing words, brand count', () => {
    expect(checkLyrics(base({ lyrics: '[Guitar solo]\n노래' })).hard.join()).toMatch(/bracket/);
    expect(checkLyrics(base({ lyrics: '노래 (아주 길게 늘어지는 괄호 속 설명)' })).hard.join()).toMatch(/parenthesis/);
    expect(checkLyrics(base({ lyrics: '우리가 최고야' })).hard.join()).toMatch(/superlative/);
    expect(checkLyrics(base({ lyrics: 'the best morning' })).hard.join()).toMatch(/superlative/);
    expect(checkLyrics(base({ lyrics: '아침 노래', mustInclude: ['물 한 잔'] })).hard.join()).toMatch(/must-include/);
    expect(checkLyrics(base({ lyrics: '아침 노래', brand: { name: 'Ecofin', readAs: '에코핀' } })).hard.join()).toMatch(/brand name is missing/);
    expect(checkLyrics(base({ lyrics: '에코핀 에코핀\n에코핀\n\n에코핀', brand: { name: 'Ecofin', readAs: '에코핀' } })).hard.join()).toMatch(/more than three/);
    expect(checkLyrics(base({ lyrics: '(oh) 에코핀과 함께\n\n[Outro]\n아침', brand: { name: 'Ecofin', readAs: '에코핀' } })).hard).toEqual([]);
  });

  it('soft: brand outside the hook, lines asked and their length, hard finals, mixed register', () => {
    expect(checkLyrics(base({ lyrics: '아침\n\n에코핀', brand: { name: 'Ecofin', readAs: '에코핀' } })).soft.join()).toMatch(/hook/);
    const short = checkLyrics(base({ lyrics: '아침 햇살', stanzaLines: [4], lineLength: true }));
    expect(short.syllables).toBe(4);
    expect(short.soft.join()).toMatch(/stanza lines 1 where 4 were asked/);
    expect(short.soft.join()).toMatch(/1 of 1 lines outside 7–10 syllables/);
    // A polish keeps the customer's lines: no line-length rule there.
    expect(checkLyrics(base({ lyrics: '아침 햇살' })).soft.join()).not.toMatch(/syllables/);
    expect(checkLyrics(base({ lyrics: '밥을 먹\n길을 걷\n책을 읽\n문을 닫' })).soft.join()).toMatch(/hard final/);
    expect(checkLyrics(base({ lyrics: '함께해요\n같이 가자\n웃어 봐\n노래해', tone: 'haeyo' })).soft.join()).toMatch(/해요체/);
    // Four lines of 7–10 syllables, as a 30 s fast hook asks (§12.11).
    const hook = '창가에 스민 아침빛이\n오늘은 조금 더 가볍게\n천천히 숨을 고르고\n나답게 하루를 열어요';
    const ok = checkLyrics(base({ lyrics: hook, stanzaLines: [4], lineLength: true }));
    expect(ok.soft).toEqual([]);
  });
});

describe('the lyrics model is a checked server setting', () => {
  it('defaults to the doc’s interim answer and takes only the five compared models', () => {
    expect(LYRICS_DEFAULT_MODEL).toBe('gemini-4-argon');
    expect(LYRICS_MODELS).toEqual(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4-neon']);
    for (const model of LYRICS_MODELS) expect(lyricsModelOf({ BRAND_SOUND_LYRICS_MODEL: ` ${model} ` })).toBe(model);
    expect(lyricsModelOf({ BRAND_SOUND_LYRICS_MODEL: 'gpt-5' })).toBe('gemini-4-argon');
    expect(isLyricsModel('gemini-4-hydrogen')).toBe(true);
    expect(isLyricsModel('gemini-4-hydrogen-high')).toBe(false);
  });
});

describe('what the model is asked', () => {
  const req = (over: Partial<LyricsRequest> = {}): LyricsRequest => ({
    flow: 'topic',
    topic: '아침 스킨케어 광고',
    language: 'ko',
    seconds: 30,
    structure: 'hook',
    tone: 'haeyo',
    brand: { name: 'Ecofin', readAs: '에코핀' },
    mustInclude: ['물 한 잔'],
    ...over,
  });

  it('carries the options: lines per stanza for each tempo band, line length, tone, brand reading, words to include', () => {
    const task = JSON.parse(lyricsTask(req())) as Record<string, unknown>;
    // 30 s: fast (118) 7 line-equivalents → a 4-line hook (the form adds the rest), slow (78) 4 lines.
    const byTempo = task.stanzasByTempo as Record<string, string[]>;
    expect(Object.keys(byTempo)).toHaveLength(3);
    expect(Object.values(byTempo).every((stanzas) => stanzas.length === STANZAS.hook)).toBe(true);
    expect(byTempo[Object.keys(byTempo).find((k) => k.startsWith('fast'))!]![0]).toMatch(/: 4 lines$/);
    expect(task.syllablesPerLine).toBe('7-10 Korean syllables');
    expect(task.tempo).toMatch(/pick the tempo band/);
    const fixed = JSON.parse(lyricsTask(req({ bpm: 92 }))) as Record<string, unknown>;
    expect(fixed.tempo).toMatch(/92 BPM/);
    expect(fixed).not.toHaveProperty('stanzasByTempo');
    expect(task.brand).toEqual({ name: 'Ecofin', writeItAs: '에코핀' });
    expect(task.mustInclude).toEqual(['물 한 잔']);
    expect(task.tone).toMatch(/해요체/);
    expect(task).not.toHaveProperty('customerLyrics');
    const polish = JSON.parse(lyricsTask(req({ flow: 'polish', lyrics: '내 가사\r\n둘째 줄' }))) as Record<string, unknown>;
    expect(polish.customerLyrics).toBe('내 가사\n둘째 줄');
    expect(lyricsTask(req(), ['missing a must-include word: 물 한 잔'])).toMatch(/fix them:\n- missing a must-include word/);
  });

  it('counts the stanzas the structure asks for, and a name is a hard problem', () => {
    expect(draftProblems(req({ brand: null, mustInclude: [], seconds: null }), 'a\n\nb\n\nc').soft.join()).toMatch(/3 stanzas where 1/);
    expect(draftProblems(req({ brand: null, mustInclude: [], seconds: 30 }), '아침 햇살\n\n물 한 잔', 118).soft.join()).toMatch(/stanza lines 1\/1 where 4 were asked/);
    expect(draftProblems(req({ brand: null, mustInclude: [], seconds: null }), '뉴진스처럼\n\n라라').hard.join()).toMatch(/names a singer/);
  });

  it('local mode: stanzas for the structure with the brand reading in the hook; a polish changes nothing but punctuation', () => {
    const text = localLyrics(req({ structure: 'hook-verse' }));
    expect(text.split('\n\n')).toHaveLength(4);
    expect(text.split('\n\n')[0]).toContain('에코핀');
    expect(localLyrics(req({ flow: 'polish', lyrics: '아침이에요.\n\n같이 가요!' }))).toBe('아침이에요\n\n같이 가요');
  });
});

describe('lyrics.draft (SA2 flows)', () => {
  let f: StudioFixture;
  const draft = (deps: ReturnType<typeof studioDeps>, over: Record<string, unknown> = {}) =>
    runStudioOperation(deps, viewerOf(f.ids.owner), 'lyrics.draft', { organizationId: f.orgId, topic: '아침 스킨케어 루틴', language: 'ko', ...over });
  const live = (fetchStub: typeof fetch, env: Record<string, string> = { GEMINI_API_KEY: 'k' }) =>
    studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env } });
  function answers(...list: unknown[]) {
    const calls: Array<{ url: string; text: string }> = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      calls.push({ url: String(url), text: body.contents[0]!.parts[0]!.text });
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(list.shift()) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchStub, calls };
  }

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture();
  });
  afterEach(async () => {
    resetFreeIntelRateLimits();
    await f.db.close();
  });

  it('rewrites once on a broken rule, sends the problems, and names the model and the tempo it chose', async () => {
    const tooShort = { bpm: 118, stanzas: [['아침 햇살', '물 한 잔']] };
    const planned = { bpm: 118, stanzas: [['창가에 스민 아침빛이', '오늘은 조금 더 가볍게', '물 한 잔을 따르고서', '나답게 하루를 열어요']] };
    const { fetchStub, calls } = answers(tooShort, planned);
    const deps = live(fetchStub, { GEMINI_API_KEY: 'k', BRAND_SOUND_LYRICS_MODEL: 'gemini-3.8-flash' });
    // 30 s at the fast band the model chose: a 4-line hook, lines of 7–10 syllables (§12.11).
    const out = await draft(deps, { topic: '신나는 아침 스킨케어 광고', seconds: 30, structure: 'hook', mustInclude: ['물 한 잔'] });
    expect(out).toMatchObject({ ok: true, flow: 'topic', model: 'gemini-3.8-flash', bpm: 118 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/models/gemini-3.8-flash:generateContent');
    expect(calls[0]!.text).toContain('"stanzasByTempo"');
    expect(calls[1]!.text).toMatch(/stanza lines 2 where 4 were asked/);
    expect((out as { lyrics: string }).lyrics.split('\n')).toHaveLength(4);
  });

  it('refuses when a hard rule survives the rewrite, and accepts a soft one', async () => {
    const missing = { stanzas: [['아침 노래'], ['같이 가요']] };
    let { fetchStub } = answers(missing, missing);
    expect(await draft(live(fetchStub), { structure: 'hook', mustInclude: ['물 한 잔'] })).toEqual({ ok: false, code: 'failed' });
    ({ fetchStub } = answers(missing, missing));
    expect(await draft(live(fetchStub), { structure: 'hook', seconds: 30 })).toMatchObject({ ok: true, lyrics: '아침 노래\n\n같이 가요' });
  });

  it('polishes the customer’s lyrics; a name in them stops it before a call', async () => {
    const { fetchStub, calls } = answers({ stanzas: [['아침이에요'], ['같이 가요']] });
    const out = await draft(live(fetchStub), { flow: 'polish', topic: '', lyrics: '아침이 왔어요 정말로.\n\n같이 가 봐요!', structure: 'hook' });
    expect(out).toEqual({ ok: true, flow: 'polish', lyrics: '아침이에요\n\n같이 가요', model: LYRICS_DEFAULT_MODEL, bpm: 100 });
    expect(calls[0]!.text).toContain('"customerLyrics": "아침이 왔어요 정말로.\\n\\n같이 가 봐요!"');
    expect(await draft(live(fetchStub), { flow: 'polish', lyrics: 'BTS처럼 신나게' })).toEqual({ ok: false, code: 'invalid', blocked: 'name' });
    expect(await draft(live(fetchStub), { flow: 'polish' })).toEqual({ ok: false, code: 'invalid' });
    expect(calls).toHaveLength(1);
  });

  it('answers locally without a key in local mode, for both flows', async () => {
    const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_SOUND_STUDIO: 'on' }) });
    expect(await draft(deps, { seconds: 15, brand: { name: 'Ecofin', readAs: '에코핀' } })).toMatchObject({ ok: true, flow: 'topic', model: 'local' });
    expect(await draft(deps, { flow: 'polish', lyrics: '하나.\n\n둘!' })).toMatchObject({ ok: true, flow: 'polish', lyrics: '하나\n\n둘', model: 'local' });
  });
});

describe('the run records who wrote its lyrics', () => {
  let f: StudioFixture;
  const sent: StudioProviderRequest[] = [];
  const recording: StudioProvider = {
    name: 'sunra_api',
    submit: async (request) => {
      sent.push(request);
      return { taskId: `pd_${sent.length}` };
    },
    status: async () => ({ state: 'pending' }),
    download: async () => {
      throw new Error('unused');
    },
  };
  const liveEnv = studioEnv({ BRAND_STUDIO_PROVIDER: 'live', SUNRA_API_KEY: 'k', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' });
  const music = (over: Record<string, unknown> = {}) => ({
    kind: 'music',
    organizationId: f.orgId,
    requestId: requestId(),
    prompt: '아침 스킨케어 광고',
    vocal: true,
    lyrics: '창가에 스민 아침빛\n\n맑은 하루가 와요',
    architect: false,
    ...over,
  });
  const params = async (id: string) =>
    (await f.sql.query<{ params: { music: Record<string, unknown> } }>('select params from brand_studio_jobs where id = $1', [id])).rows[0]!.params.music;

  beforeEach(async () => {
    resetFreeIntelRateLimits();
    sent.length = 0;
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  it('keeps the flow and the model with the run, and sends the structure’s marks', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never });
    const drafted = await createStudioJob(deps, viewerOf(f.ids.owner), music({ structure: 'hook', lyricsBy: { flow: 'topic', model: 'gemini-4-argon' } }));
    if (!('job' in drafted)) throw new Error(JSON.stringify(drafted));
    expect(await params(drafted.job.id)).toMatchObject({ structure: 'hook', lyricsBy: { flow: 'topic', model: 'gemini-4-argon' } });
    await advanceStudioJobsWith(deps, { jobIds: [drafted.job.id] });
    expect(sent[0]!.body.lyrics).toBe('[Chorus]\n창가에 스민 아침빛\n\n[Outro]\n맑은 하루가 와요');

    const own = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in own)) throw new Error('own');
    expect(await params(own.job.id)).toMatchObject({ lyricsBy: { flow: 'own', model: null } });
    expect(await params(own.job.id)).not.toHaveProperty('structure');

    const instrumental = await createStudioJob(deps, viewerOf(f.ids.owner), music({ vocal: false, lyricsBy: { flow: 'topic', model: 'gemini-4-argon' } }));
    if (!('job' in instrumental)) throw new Error('instrumental');
    expect(await params(instrumental.job.id)).not.toHaveProperty('lyricsBy');
  });

  it('refuses a model outside the allowed list', async () => {
    const deps = studioDeps(f.sql, { env: liveEnv, provider: recording as never });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), music({ lyricsBy: { flow: 'topic', model: 'gemini-x' } }))).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('sizing lyrics to a length (§12.8)', () => {
  const audio = (seconds: number | null) =>
    ({ id: randomUUID(), jobId: 'j', kind: 'audio', url: '/a', thumbUrl: null, width: null, height: null, seconds, draft: false, savedAssetId: null, createdAt: '2026-11-21T00:00:00.000Z' }) as const;
  const job = (targetSeconds: number | null, outputs: Array<ReturnType<typeof audio>>): StudioJobView =>
    ({
      id: randomUUID(),
      kind: 'music',
      status: 'succeeded',
      prompt: '밝은 팝',
      music: { title: '밝은 팝', vocal: true, mode: 'custom', careful: false, lyrics: '가사', ...(targetSeconds ? { targetSeconds } : {}) },
      outputs,
      createdAt: '2026-11-21T01:00:00.000Z',
    }) as unknown as StudioJobView;

  it('lists the version closest to the target length first, as A', () => {
    const rows = musicTracks(ORG, [job(30, [audio(92), audio(34)])], []);
    expect(rows.map((r) => [r.letter, r.seconds])).toEqual([
      ['A', 34],
      ['B', 92],
    ]);
    // No target (an instrumental, or lyrics without the control): the order they came back in.
    expect(musicTracks(ORG, [job(null, [audio(92), audio(34)])], []).map((r) => r.seconds)).toEqual([92, 34]);
    // An unmeasured version goes last.
    expect(musicTracks(ORG, [job(15, [audio(null), audio(40)])], []).map((r) => r.seconds)).toEqual([40, null]);
  });

  it('keeps the target with the run, never sends lyrics for an instrumental, and validates the length', () => {
    const base = { kind: 'music' as const, organizationId: ORG, requestId: 'req_12345678', prompt: '밝은 팝', architect: false };
    const sung = planMusic({ ...base, vocal: true, lyrics: '하나\n\n둘', structure: 'hook', targetSeconds: 15 }, 'ko');
    expect(sung.params.music).toMatchObject({ targetSeconds: 15, structure: 'hook' });
    const instrumental = planMusic({ ...base, vocal: false, lyrics: '하나', structure: 'hook', targetSeconds: 15, careful: true }, 'ko');
    expect(instrumental.engine.request(instrumental.request).body).toMatchObject({ lyrics: '', instrumental: true });
    expect(instrumental.params.music).not.toHaveProperty('targetSeconds');
    expect(instrumental.params.music).not.toHaveProperty('structure');
  });
});
