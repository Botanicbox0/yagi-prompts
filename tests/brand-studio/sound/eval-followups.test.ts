import { afterEach, describe, expect, it, vi } from 'vitest';
import { designMeta, designMusic, subjectSentence, type MusicDesignInput } from '@/lib/brand-studio/sound/architect';
import { LYRICS_TIMEOUTS, writeLyricsWithFallback, type LyricsRequest } from '@/lib/brand-studio/sound/lyrics-draft';

/**
 * The lead's review of #296 (merged 57f43bf4), three small things:
 *  1. two answers whose only problem is the title threw away a good style: the style is kept, the title replaced;
 *  2. the sentence added after the style shows in the dock: no "in the customer's words", no `.".`;
 *  3. `LYRICS_TIMEOUTS.totalMs` was not used: a draft now keeps to it.
 */
const GOOD_STYLE =
  'Warm acoustic pop with a light, hopeful feel, around 96 BPM, relaxed. A warm female vocal sings softly in Korean. ' +
  'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks underneath, and brushed drums keep time. ' +
  'A short intro, the hook arrives early and returns once. Warm and close, a little room. Ends cleanly on a held chord.';

function geminiAnswers(...answers: Array<Record<string, unknown> | Error | (() => Error)>) {
  const calls: string[] = [];
  const fetchStub = (async (url: string) => {
    calls.push(String(url).split('/models/')[1] ?? '');
    const next = answers.shift();
    if (typeof next === 'function') throw next();
    if (!next || next instanceof Error) throw next ?? new Error('no answer');
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchStub, calls };
}

const input = (over: Partial<MusicDesignInput> = {}): MusicDesignInput => ({
  prompt: '국내 최고 1위 브랜드답게 웅장하게',
  vocal: false,
  lyrics: '',
  careful: false,
  language: 'ko',
  locale: 'ko',
  ...over,
});
const env = { GEMINI_API_KEY: 'k' };

describe('1. a title problem alone keeps the designed style', () => {
  it('keeps the style and the notes, replaces the title with a safe name, and records why', async () => {
    const bad = { style: GOOD_STYLE, title: '국내 최고 1위 브랜드답게 웅장하게', notes: '웅장한 오케스트라로 설계했어요.' };
    const { fetchStub, calls } = geminiAnswers(bad, bad);
    const design = await designMusic(input(), { fetch: fetchStub, env });
    expect(calls).toHaveLength(2);
    expect(design).toMatchObject({ source: 'model', style: GOOD_STYLE, notes: '웅장한 오케스트라로 설계했어요.', fallbackReason: 'title_check_failed' });
    // The request's first words carry the superlative, so they cannot stand in: the fixed name does.
    expect(design.title).toBe('새 곡');
    expect(designMeta(design)).toMatchObject({ source: 'model', title: '새 곡', fallbackReason: 'title_check_failed' });
  });

  it('uses the request’s first words when they are safe, and the English name on an English screen', async () => {
    const copy = { style: GOOD_STYLE, title: '아침 스킨케어 광고', notes: 'ok' };
    const ko = geminiAnswers(copy, copy);
    expect((await designMusic(input({ prompt: '아침 스킨케어 광고, 잔잔하게' }), { fetch: ko.fetchStub, env })).title).toBe('아침 스킨케어 광고');
    const en = { style: GOOD_STYLE, title: 'The best launch ever', notes: 'ok' };
    const english = geminiAnswers(en, en);
    expect((await designMusic(input({ prompt: 'The best launch ever, grand', locale: 'en', language: 'en' }), { fetch: english.fetchStub, env })).title).toBe('New track');
  });

  it('still falls back when the style itself breaks a rule twice', async () => {
    const bad = { style: `${GOOD_STYLE} Keep it to 30 seconds.`, title: '웅장한 행진', notes: 'ok' };
    const { fetchStub } = geminiAnswers(bad, bad);
    expect(await designMusic(input(), { fetch: fetchStub, env })).toMatchObject({ source: 'fallback', fallbackReason: 'check_failed' });
  });
});

describe('2. the sentence after the style reads well in the dock', () => {
  const sung = (prompt: string) => subjectSentence(input({ prompt, vocal: true }));

  it('quotes the request without speaking about the customer, and never doubles the full stop', () => {
    const line = sung('브랜드 모아 (레몬 탄산수). 메시지: 한 모금에 기분이 맑아진다. 꼭 넣을 말: 모아.');
    expect(line).not.toMatch(/customer/i);
    expect(line).not.toContain('.".');
    expect(line).toBe('The lyrics are about: "브랜드 모아 (레몬 탄산수). 메시지: 한 모금에 기분이 맑아진다. 꼭 넣을 말: 모아."');
    expect(sung('레몬 탄산수 광고, 상쾌하게')).toBe('The lyrics are about: "레몬 탄산수 광고, 상쾌하게".');
    expect(sung('여름이 왔어요!')).toBe('The lyrics are about: "여름이 왔어요!"');
    expect(sung('가'.repeat(400)).endsWith('…"')).toBe(true);
  });
});

describe('3. a lyrics draft keeps to the total time', () => {
  const req: LyricsRequest = { flow: 'topic', topic: '아침 스킨케어 루틴', language: 'ko', seconds: 15, structure: 'hook', tone: 'haeyo', brand: null, mustInclude: [] };
  const good = { stanzas: [['창가에 스민 아침빛', '오늘은 조금 더 가볍게'], ['맑은 하루가 와요', '오늘도 가볍게']] };
  const config = { apiKey: 'k', baseUrl: 'https://g', model: 'gemini-4-argon' };
  const abortedAfter = (ms: number) => () => {
    vi.setSystemTime(Date.now() + ms);
    return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  };
  afterEach(() => vi.useRealTimers());

  it('hands over when there is time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fetchStub, calls } = geminiAnswers(abortedAfter(LYRICS_TIMEOUTS.firstCallMs), good, good);
    expect((await writeLyricsWithFallback(req, config, fetchStub)).model).toBe('gemini-3.8-flash');
    expect(calls[0]).toBe('gemini-4-argon:generateContent');
  });

  it('does not start the fast model when the total is nearly spent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fetchStub, calls } = geminiAnswers(abortedAfter(LYRICS_TIMEOUTS.totalMs - 1_000), good, good);
    await expect(writeLyricsWithFallback(req, config, fetchStub)).rejects.toThrow(/aborted/);
    expect(calls).toHaveLength(1);
  });

  it('skips a rewrite past the total and keeps a draft that only misses a soft rule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The first answer comes back after almost the whole budget, with a soft problem (syllables): kept, no rewrite.
    const slowGood = () => {
      vi.setSystemTime(Date.now() + LYRICS_TIMEOUTS.totalMs - 1_000);
      return good;
    };
    const calls: string[] = [];
    const fetchStub = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(slowGood()) }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const answer = await writeLyricsWithFallback(req, config, fetchStub);
    expect(calls).toHaveLength(1);
    expect(answer.model).toBe('gemini-4-argon');
    expect(answer.text).toContain('창가에 스민 아침빛');
  });
});
