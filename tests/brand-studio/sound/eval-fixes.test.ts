import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { checkMusicDesign, designMeta, designMusic, fallbackDesign, safeNotes, subjectSentence, type MusicDesign, type MusicDesignInput } from '@/lib/brand-studio/sound/architect';
import { LYRICS_FALLBACK_MODEL, LYRICS_TIMEOUTS, writeLyricsWithFallback, type LyricsRequest } from '@/lib/brand-studio/sound/lyrics-draft';
import { planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { jobView } from '@/lib/brand-studio/repo';
import type { JobRow } from '@/lib/brand-studio/types';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * The fixes from the real text-model eval of 2026-11-21 (main fc198488, run by the lead with the founder's approval):
 *  1. a sung request with no lyrics lost the brand and the message on the way to the engine (describe mode sent only
 *     the English style paragraph);
 *  2. the lyrics draft hit its 25 s limit once on the default model;
 *  3. the describe-mode name was the request's first words, and the notes repeated the customer's superlative;
 *  4. the eval script ended on one case's error and kept only the table.
 * The model answers below are the ones the real run returned (D:\dev\_backups\twings-sound-tests-20261120\text-eval-20261121).
 */
const ROOT = process.cwd();

/** brief-jingle-ko, as the real run designed it (gemini-4-hydrogen, suno@2026-11-21.1). */
const OBSERVED_JINGLE = {
  style:
    'Bright indie pop with a sparkling, refreshing feel. Around 116 BPM, upbeat and bouncy. A bright female vocal in a clear mid-high register delivers playful, airy phrases in Korean. Crisp acoustic guitar strums a light, rhythmic chord progression. A bouncy electric bass locks in with the kick to keep the groove moving. Sparkling synth bells add a crisp, effervescent shimmer on top. A short, bubbly intro opens into a catchy, uplifting hook that builds with handclaps. The mix is clean, airy, and bright with a punchy low end.',
  title: '브랜드 모아 (레몬 탄산수)',
  notes: '상쾌하고 가벼운 느낌의 인디 팝 장르에 밝은 여성 보컬을 더해 청량한 분위기를 담아냈어요.',
};
/** trap-superlative, as the real run designed it. */
const OBSERVED_SUPERLATIVE = {
  style:
    'Cinematic orchestral hybrid, grand and triumphant. Around 108 BPM, driving and stately. Instrumental, with a soaring brass section carrying the main melody. Lush string ensembles play sweeping legato chords that build emotional depth. Deep taiko drums and crisp snare rolls drive the rhythm forward with authority. A bright piano and subtle synth pads add modern polish and shimmer underneath. A quiet atmospheric intro, a rising pre-chorus build, and a massive heroic hook that lands with full orchestral power. Wide cinematic stereo field with a punchy low end and gleaming highs.',
  title: '국내 최고 1위 브랜드답게 웅장하게',
  notes: '국내 최고 브랜드의 위상에 어울리는 웅장한 오케스트라 사운드와 힘 있는 타악기가 어우러진 인스트루멘털 곡으로 디자인했어요.',
};

function geminiAnswers(...answers: Array<Record<string, unknown> | Error>) {
  const calls: Array<{ url: string; text: string }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    calls.push({ url: String(url), text: body.contents[0]!.parts[0]!.text });
    const next = answers.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no answer');
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchStub, calls };
}

const env = { GEMINI_API_KEY: 'k' };
const aborted = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const jingle = (over: Partial<MusicDesignInput> = {}): MusicDesignInput => ({
  prompt: '브랜드 모아 (레몬 탄산수). 메시지: 한 모금에 기분이 맑아진다. 꼭 넣을 말: 모아. 톤: 상쾌하고 가볍게. 보컬: 밝은 여성 보컬.',
  vocal: true,
  lyrics: '',
  careful: false,
  language: 'ko',
  locale: 'ko',
  ...over,
});

describe('1. a sung request without lyrics keeps what the song is about', () => {
  it('the eval check fails the design the real run sent (the brand never reached the engine)', async () => {
    const evalScript = await import('../../../scripts/sound-architect-eval');
    const sheet = readFileSync(join(ROOT, 'docs/research/brand-sound-studio-2026-11-20/lyrics-blind-sheet.md'), 'utf8');
    const c = evalScript.briefCases(sheet).find((x) => x.id === 'brief-jingle-ko')!;
    expect(c.expect?.words).toEqual(['모아']);
    const sent: MusicDesign = { ...fallbackDesign(c.input), mode: 'describe', style: OBSERVED_JINGLE.style, title: OBSERVED_JINGLE.title, source: 'model', llmModel: 'gemini-4-hydrogen' };
    const scored = evalScript.scoreDesign(c, sent, 0);
    expect(scored.verdict).toBe('fail');
    expect(scored.problems.join(' ')).toMatch(/"모아" did not reach the engine/);
  });

  it('the same model answer now reaches the engine with the brief quoted: the check passes', async () => {
    const evalScript = await import('../../../scripts/sound-architect-eval');
    const sheet = readFileSync(join(ROOT, 'docs/research/brand-sound-studio-2026-11-20/lyrics-blind-sheet.md'), 'utf8');
    const c = evalScript.briefCases(sheet).find((x) => x.id === 'brief-jingle-ko')!;
    const { fetchStub } = geminiAnswers({ ...OBSERVED_JINGLE, title: '한 모금의 맑음' });
    const design = await designMusic(c.input, { fetch: fetchStub, env });
    expect(design).toMatchObject({ mode: 'describe', source: 'model' });
    expect(design.style.startsWith(OBSERVED_JINGLE.style)).toBe(true);
    expect(design.style).toContain('모아');
    expect(evalScript.scoreDesign(c, design, 0)).toMatchObject({ verdict: 'pass', problems: [] });
  });

  it('the words from the lyrics options go too, written the way the customer asked; never for an instrumental or written lyrics', () => {
    const words = { brand: { name: 'Ecofin', readAs: '에코핀' }, mustInclude: ['맑게', '에코핀'] };
    const line = subjectSentence(jingle({ prompt: '친환경 세제 광고, 밝게', words }));
    expect(line).toContain('"친환경 세제 광고, 밝게"');
    expect(line).toContain('"에코핀", "맑게"');
    expect(line).not.toContain('Ecofin');
    expect(subjectSentence(jingle({ vocal: false, words }))).toBe('');
    expect(subjectSentence(jingle({ lyrics: '아침 햇살이 창을 두드리면', words }))).toBe('');
    // The fallback (no key) already quotes the request; it adds only the words line, and only when there are words.
    expect(fallbackDesign(jingle()).style).toBe(`${jingle().prompt} Vocals sung in Korean.`);
    expect(fallbackDesign(jingle({ prompt: '친환경 세제 광고, 밝게', words })).style).toContain('"에코핀", "맑게"');
  });

  it('keeps the whole request under the 1,000 characters the dock can send: the model is told the room it has', async () => {
    const long = 'Warm acoustic pop with a light, hopeful feel, around 96 BPM, relaxed. '.repeat(13).trim();
    expect(long.length).toBeGreaterThan(850);
    const { fetchStub, calls } = geminiAnswers({ style: long, title: '맑은 하루', notes: 'ok' }, { style: OBSERVED_JINGLE.style, title: '맑은 하루', notes: 'ok' });
    const design = await designMusic(jingle(), { fetch: fetchStub, env });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.text).toMatch(/style is over \d+ characters/);
    expect(design.style.length).toBeLessThanOrEqual(1000);
    expect(design.style).toContain('모아');
  });

  it('keeps the words on the run, checks them for names, and sends them with the request', async () => {
    const plan = planMusic(
      { kind: 'music', organizationId: '00000000-0000-4000-8000-0000000000ef', requestId: 'req_words_1', prompt: '친환경 세제 광고, 밝게', vocal: true, architect: false, words: { brand: { name: 'Ecofin' }, mustInclude: ['맑게'] } },
      'ko',
    );
    expect(plan.request.mode).toBe('describe');
    expect(plan.request.prompt).toContain('"Ecofin", "맑게"');
    expect(plan.params.music?.words).toEqual({ brand: { name: 'Ecofin' }, mustInclude: ['맑게'] });
  });
});

describe('2. the lyrics draft does not leave the customer with an error when the first model is slow', () => {
  const req: LyricsRequest = { flow: 'topic', topic: '아침 스킨케어 루틴', language: 'ko', seconds: 15, structure: 'hook', tone: 'haeyo', brand: null, mustInclude: [] };
  const good = { stanzas: [['창가에 스민 아침빛', '오늘은 조금 더 가볍게'], ['맑은 하루가 와요', '오늘도 가볍게']] };
  const config = { apiKey: 'k', baseUrl: 'https://g', model: 'gemini-4-argon' };

  it('gives each call more time than the 25 s that ran out, inside the route’s 300 s', () => {
    expect(LYRICS_TIMEOUTS.firstCallMs).toBeGreaterThanOrEqual(40_000);
    expect(LYRICS_TIMEOUTS.totalMs).toBeLessThan(300_000);
    expect(LYRICS_FALLBACK_MODEL).toBe('gemini-3.8-flash');
  });

  it('hands a timed-out or failed first call to the fast model once, and names the model that wrote them', async () => {
    for (const first of [aborted(), new TypeError('fetch failed')]) {
      // The fast model gets its own rewrite when a soft rule is off (the second answer), like any draft.
      const { fetchStub, calls } = geminiAnswers(first, good, good);
      const answer = await writeLyricsWithFallback(req, config, fetchStub);
      expect(answer).toMatchObject({ text: '창가에 스민 아침빛\n오늘은 조금 더 가볍게\n\n맑은 하루가 와요\n오늘도 가볍게', model: 'gemini-3.8-flash' });
      const models = calls.map((c) => c.url.split('/models/')[1]);
      expect(models[0]).toBe('gemini-4-argon:generateContent');
      expect(models.length).toBeGreaterThan(1);
      expect(models.slice(1).every((m) => m === 'gemini-3.8-flash:generateContent')).toBe(true);
    }
  });

  it('does not hand over a refusal (that is not a transport failure), and does not fall back twice', async () => {
    const refused = geminiAnswers(new Error('gemini_blocked'));
    await expect(writeLyricsWithFallback(req, config, refused.fetchStub)).rejects.toThrow('gemini_blocked');
    expect(refused.calls).toHaveLength(1);
    const both = geminiAnswers(aborted(), aborted());
    await expect(writeLyricsWithFallback(req, config, both.fetchStub)).rejects.toThrow(/aborted/);
    expect(both.calls).toHaveLength(2);
    const flash = geminiAnswers(aborted());
    await expect(writeLyricsWithFallback(req, { ...config, model: 'gemini-3.8-flash' }, flash.fetchStub)).rejects.toThrow(/aborted/);
    expect(flash.calls).toHaveLength(1);
  });

  describe('through lyrics.draft', () => {
    let f: StudioFixture;
    beforeEach(async () => {
      resetFreeIntelRateLimits();
      f = await studioFixture();
    });
    afterEach(async () => {
      resetFreeIntelRateLimits();
      await f.db.close();
    });

    it('answers with the fast model’s lyrics and names it, so the run records who wrote them', async () => {
      const { fetchStub } = geminiAnswers(aborted(), good, good);
      const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'live', BRAND_SOUND_STUDIO: 'on' }), intelDeps: { fetch: fetchStub, env } });
      const out = await runStudioOperation(deps, viewerOf(f.ids.owner), 'lyrics.draft', { organizationId: f.orgId, topic: '아침 스킨케어 루틴', language: 'ko', seconds: 15 });
      expect(out).toMatchObject({ ok: true, flow: 'topic', model: 'gemini-3.8-flash' });
    });
  });
});

describe('3. the name and the notes are the model’s, not the customer’s claim', () => {
  it('names a describe-mode track with the model’s title, and the run lists it under that name', async () => {
    const { fetchStub } = geminiAnswers({ ...OBSERVED_JINGLE, title: '한 모금의 맑음' });
    const design = await designMusic(jingle(), { fetch: fetchStub, env });
    expect(design.title).toBe('한 모금의 맑음');
    expect(designMeta(design).title).toBe('한 모금의 맑음');
    const row = {
      id: 'j',
      kind: 'music',
      status: 'running',
      model: 'suno-v6',
      prompt: jingle().prompt,
      params: { music: { mode: 'describe', vocal: true, language: 'ko', title: '브랜드 모아 (레몬 탄산수)', careful: false } },
      work: { prepared: true, enhancer: designMeta(design) },
    } as unknown as JobRow;
    expect(jobView(row, [], { url: (k: string) => k } as never).music?.title).toBe('한 모금의 맑음');
  });

  it('rewrites a title that copies the request or carries a superlative, in either mode', async () => {
    expect(checkMusicDesign({ style: OBSERVED_JINGLE.style, title: OBSERVED_JINGLE.title }, 'describe', jingle().prompt).join(' ')).toMatch(/copies the start of the request/);
    expect(checkMusicDesign({ style: OBSERVED_SUPERLATIVE.style, title: OBSERVED_SUPERLATIVE.title }, 'describe', '국내 최고 1위 브랜드답게 웅장하게').join(' ')).toMatch(/superlative/);
    const { fetchStub, calls } = geminiAnswers(OBSERVED_SUPERLATIVE, { ...OBSERVED_SUPERLATIVE, title: '웅장한 행진', notes: '웅장한 오케스트라와 힘 있는 타악기로 설계했어요.' });
    const design = await designMusic(jingle({ prompt: '국내 최고 1위 브랜드답게 웅장하게', vocal: false }), { fetch: fetchStub, env });
    expect(calls).toHaveLength(2);
    expect(design).toMatchObject({ source: 'model', title: '웅장한 행진', notes: '웅장한 오케스트라와 힘 있는 타악기로 설계했어요.' });
  });

  it('never shows notes that carry a superlative: the screen’s own sentence instead', () => {
    expect(safeNotes(OBSERVED_SUPERLATIVE.notes)).toBeNull();
    expect(safeNotes('The best fit for a premium launch.')).toBeNull();
    expect(safeNotes(OBSERVED_JINGLE.notes)).toBe(OBSERVED_JINGLE.notes);
  });
});

describe('4. the eval script keeps going and keeps the raw text', () => {
  it('records one case’s error and runs the rest', async () => {
    const { runCases } = await import('../../../scripts/sound-architect-eval');
    const out = await runCases(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('This operation was aborted');
      return id.toUpperCase();
    });
    expect(out).toEqual([
      { id: 'a', ok: true, value: 'A', ms: expect.any(Number) },
      { id: 'b', ok: false, error: 'This operation was aborted', ms: expect.any(Number) },
      { id: 'c', ok: true, value: 'C', ms: expect.any(Number) },
    ]);
  });

  it('writes the full design, the lyrics and every call’s time next to the table, with the key scrubbed', async () => {
    const { rawSection } = await import('../../../scripts/sound-architect-eval');
    const text = rawSection({ id: 'brief-jingle-ko', input: jingle(), lyrics: { text: '모아 한 모금', model: 'gemini-4-argon' }, design: fallbackDesign(jingle()), body: { prompt: 'x secret-key' }, calls: [{ model: 'gemini-4-argon', ms: 7900 }], error: null }, (t) => t.split('secret-key').join('<key>'));
    expect(text).toContain('## brief-jingle-ko');
    expect(text).toContain('모아 한 모금');
    expect(text).toContain('gemini-4-argon 7900 ms');
    expect(text).toContain('<key>');
    expect(text).not.toContain('secret-key');
  });
});
