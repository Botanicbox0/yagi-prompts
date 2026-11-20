import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { designMusic, fallbackDesign, type MusicDesignInput } from '@/lib/brand-studio/sound/architect';
import { formText, sungPlan } from '@/lib/brand-studio/sound/length-plan';
import { closestFirst } from '@/lib/brand-studio/sound/library';
import { planMusic } from '@/lib/brand-studio/sound/music-jobs';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * The length plan through a whole run (docs/BRAND-SOUND-STUDIO.md §12.11): the tempo decided once, the form in the
 * sent lyrics, the design held to both, the plan on the row, and the version that reaches the length listed first.
 */
const ORG = '00000000-0000-4000-8000-0000000000ef';
const PROMPT = '레몬 탄산수 광고, 상쾌하고 가볍게, 밝은 여성 보컬';
const HOOK = '노란 레몬 탄산이 톡 터지면\n유리잔 위로 방울이 올라와\n한 모금에 기분이 맑아져\n내 손안에 시원한 모아';
const STYLE = (bpm: number, tail = 'It opens with a four-bar instrumental intro, the hook is sung, an instrumental break follows and the hook returns.') =>
  `Bright indie pop with a sparkling, refreshing feel. Around ${bpm} BPM, light and bouncy. A bright female voice sings in Korean. ` +
  `A clean electric guitar strums crisp chords and a nimble bassline bounces underneath. ${tail} The mix is airy and crisp.`;

function geminiAnswers(...answers: Array<Record<string, unknown>>) {
  const texts: string[] = [];
  const fetchStub = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ parts: Array<{ text: string }> }> };
    texts.push(`${body.systemInstruction.parts[0]!.text}\n---\n${body.contents[0]!.parts[0]!.text}`);
    const next = answers.shift();
    if (!next) throw new Error('no answer');
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchStub, texts };
}

describe('the plan a run sends and keeps', () => {
  const create = (over: Record<string, unknown> = {}) => ({
    kind: 'music' as const,
    organizationId: ORG,
    requestId: 'req_length_plan_1',
    prompt: PROMPT,
    vocal: true,
    lyrics: HOOK,
    structure: 'hook' as const,
    targetSeconds: 30,
    architect: false,
    ...over,
  });

  it('a drafted 4-line hook for 30 s at 118 BPM: intro, hook, an empty outro, the plan on the row', () => {
    const plan = planMusic({ ...create(), lyricsBy: { flow: 'topic', model: 'gemini-4-argon' }, bpm: 118 }, 'ko');
    expect(plan.request.lyrics).toBe(`[Intro]\n\n[Chorus]\n${HOOK}\n\n[Outro]`);
    // 4 × 2.5 + 2 × 2.7 = 15.4 of 14.75 bars.
    expect(plan.params.music?.plan).toMatchObject({ bpm: 118, band: 'fast', seconds: 30, targetBars: 14.8, needed: 6, bars: 15.4, enough: true });
    expect(plan.request.prompt).toContain('Around 118 BPM. The form, in order: a four-bar instrumental intro, then the hook, then an instrumental outro.');
  });

  it('a drafted hook for 60 s at 118 BPM is the measured form: intro, hook, break, hook again, break, 2-line outro', () => {
    const lyrics = `${HOOK}\n\n오늘도 가볍게 모아\n맑아지는 이 기분`;
    const plan = planMusic({ ...create({ lyrics, targetSeconds: 60 }), lyricsBy: { flow: 'topic', model: 'gemini-4-argon' }, bpm: 118 }, 'ko');
    expect(plan.request.lyrics).toBe(`[Intro]\n\n[Chorus]\n${HOOK}\n\n[Instrumental Break]\n\n[Chorus]\n${HOOK}\n\n[Instrumental Break]\n\n[Outro]\n오늘도 가볍게 모아\n맑아지는 이 기분`);
  });

  it('the customer’s own three lines: sections only, never their lines again, and the row says it is short', () => {
    const plan = planMusic(create({ lyrics: '노란 레몬 탄산이 톡 터지는 모아\n\n유리잔 위로 방울이 올라와\n내 손안에 시원한 모아' }), 'ko');
    expect(plan.request.lyrics).toBe('[Intro]\n\n[Chorus]\n노란 레몬 탄산이 톡 터지는 모아\n\n[Instrumental Break]\n\n[Outro]\n유리잔 위로 방울이 올라와\n내 손안에 시원한 모아');
    // "상쾌·가볍게" read as fast (120 BPM): 15 bars wanted, 3 lines + 2 sections plan 12.9.
    expect(plan.params.music?.plan).toMatchObject({ bpm: 120, enough: false, targetBars: 15, bars: 12.9 });
  });

  it('a BPM written in the description wins over the draft’s; no length, no plan (as before)', () => {
    expect(planMusic({ ...create({ prompt: `${PROMPT}, 92 BPM` }), lyricsBy: { flow: 'topic', model: 'gemini-4-argon' }, bpm: 118 }, 'ko').params.music?.plan?.bpm).toBe(92);
    expect(planMusic(create({ targetSeconds: undefined }), 'ko').params.music?.plan).toBeUndefined();
  });
});

describe('the design keeps the tempo and describes the form', () => {
  const plan = sungPlan({ prompt: PROMPT, vocal: true, lyrics: HOOK, structure: 'hook', seconds: 30, draftBpm: 118, drafted: true })!;
  const input = (over: Partial<MusicDesignInput> = {}): MusicDesignInput => ({ prompt: PROMPT, vocal: true, lyrics: HOOK, careful: false, structure: 'hook', language: 'ko', locale: 'ko', plan, ...over });

  it('tells the model the tempo and the form, and rewrites a style at another tempo or "straight into the hook"', async () => {
    expect(formText(plan.form)).toBe('[Intro] [Chorus] [Outro]');
    const { fetchStub, texts } = geminiAnswers(
      { style: STYLE(96), title: '맑은 한 모금', notes: 'ok' },
      { style: STYLE(118, 'It drops into a catchy hook right away.'), title: '맑은 한 모금', notes: 'ok' },
    );
    const failed = await designMusic(input(), { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } });
    expect(texts[0]).toContain('Tempo: 118 BPM exactly');
    expect(texts[0]).toContain('never say it goes straight into the hook');
    expect(texts[1]).toMatch(/96 BPM; the lyrics are planned at 118 BPM/);
    // Both answers broke a style rule: the fallback, which carries the tempo and the form itself.
    expect(failed.source).toBe('fallback');
    expect(failed.style).toContain('Around 118 BPM.');
    const good = geminiAnswers({ style: STYLE(118), title: '맑은 한 모금', notes: 'ok' });
    const design = await designMusic(input(), { fetch: good.fetchStub, env: { GEMINI_API_KEY: 'k' } });
    expect(design).toMatchObject({ source: 'model', style: STYLE(118) });
    expect(design.lyrics.startsWith('[Intro]\n\n[Chorus]\n')).toBe(true);
    expect(fallbackDesign(input()).lyrics).toBe(design.lyrics);
  });
});

describe('a whole run, and the version listed first', () => {
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
  beforeEach(async () => {
    resetFreeIntelRateLimits();
    sent.length = 0;
    f = await studioFixture();
  });
  afterEach(async () => {
    resetFreeIntelRateLimits();
    await f.db.close();
  });

  it('sends the planned form from the row after the design, and the design preview plans the same', async () => {
    const { fetchStub } = geminiAnswers({ existing: false, confidence: 0.05 }, { style: STYLE(118), title: '맑은 한 모금', notes: 'ok' }, { style: STYLE(118), title: '맑은 한 모금', notes: 'ok' });
    const env = studioEnv({ BRAND_STUDIO_PROVIDER: 'live', SUNRA_API_KEY: 'k', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on' });
    const deps = studioDeps(f.sql, { env, provider: recording as never, intelDeps: { fetch: fetchStub, env: { GEMINI_API_KEY: 'k' } } });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), {
      kind: 'music',
      organizationId: f.orgId,
      requestId: requestId(),
      prompt: PROMPT,
      vocal: true,
      lyrics: HOOK,
      structure: 'hook',
      targetSeconds: 30,
      lyricsBy: { flow: 'topic', model: 'gemini-4-argon' },
      bpm: 118,
    });
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(sent[0]!.body).toMatchObject({ style: STYLE(118), lyrics: `[Intro]\n\n[Chorus]\n${HOOK}\n\n[Outro]` });
    const preview = await runStudioOperation(deps, viewerOf(f.ids.owner), 'music.design', {
      organizationId: f.orgId,
      prompt: PROMPT,
      vocal: true,
      lyrics: HOOK,
      structure: 'hook',
      targetSeconds: 30,
      bpm: 118,
      lyricsBy: { flow: 'topic', model: 'gemini-4-argon' },
    });
    expect(preview).toMatchObject({ ok: true, design: { style: STYLE(118) } });
  });

  it('lists first the version that reaches the length, closest first; the longer when none does', () => {
    const order = (target: number, lengths: number[]) => lengths.map((seconds) => ({ seconds })).sort(closestFirst(target)).map((v) => v.seconds);
    expect(order(30, [27.3, 34.4])).toEqual([34.4, 27.3]);
    expect(order(30, [43.7, 31.1])).toEqual([31.1, 43.7]);
    expect(order(30, [16, 22.9])).toEqual([22.9, 16]);
  });
});
