import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const routeMock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  loadPromptBySlug: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));
vi.mock('@/lib/prompts/repo', async (original) => ({
  ...(await original<typeof import('@/lib/prompts/repo')>()),
  loadPromptBySlug: routeMock.loadPromptBySlug,
}));

import { compileDirectorPrompt } from '@/lib/template-director/flash-director';
import { PERSONAL_BGM_MOOD_PROMPTS, PERSONAL_NO_BGM_AUDIO_CONTRACT_EN } from '@/lib/template-director/morphic-production-playbook';
import { POST as directorPOST } from '@/app/api/template-director/route';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';
import type { PublicRecipe } from '@/lib/recipes/public';

const BASE_VIDEO_PROMPT =
  'A stylish night street arrival in Seoul following @Image 1 in sharp three-quarter tracking motion.';

describe('Seedance audio compilation + POST /api/template-director + reference disclosure UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    routeMock.viewer.mockResolvedValue({ userId: 'u-111', isAdmin: false, tier: 'free', locale: 'ko' });
    routeMock.sql.mockResolvedValue({ query: vi.fn() });
    routeMock.loadPromptBySlug.mockResolvedValue({
      id: 'tpl-1',
      slug: 'runway-arrival',
      status: 'published',
      audience: 'public',
      medium: 'video',
      title: 'Runway Arrival',
      titleKo: '런웨이 도착',
      processMd: 'Smooth street dolly-in',
      processMdKo: '도심 야간 워킹 원테이크',
    });
  });

  it('compiles strict No-BGM audio in ambient mode and mood-matched BGM in bgm mode', async () => {
    const ambientCompiled = await compileDirectorPrompt(
      {
        basePrompt: BASE_VIDEO_PROMPT,
        medium: 'video',
        hasOutfitRef: true,
        directorSpec: {
          audioMode: 'ambient',
          bgmMood: null,
          summaryChips: [{ slot: 'outfit', labelKo: '의상', summaryKo: '블랙 가죽 자켓' }],
        },
      },
      { env: {} },
    );

    expect(ambientCompiled).toContain('Strict No-BGM Personal Audio Rule');
    expect(ambientCompiled).toContain('Strictly NO background music');
    expect(ambientCompiled).not.toContain(PERSONAL_BGM_MOOD_PROMPTS.trendy_beat);

    const bgmCompiled = await compileDirectorPrompt(
      {
        basePrompt: BASE_VIDEO_PROMPT,
        medium: 'video',
        directorSpec: {
          audioMode: 'bgm',
          bgmMood: 'trendy_beat',
          userMessage: '도심 야간 워킹 느낌으로 어울리는 비트 넣어줘',
        },
      },
      { env: {} },
    );

    expect(bgmCompiled).toContain(PERSONAL_BGM_MOOD_PROMPTS.trendy_beat);
    expect(bgmCompiled).not.toContain(PERSONAL_NO_BGM_AUDIO_CONTRACT_EN);
    expect(bgmCompiled).not.toContain('Strict No-BGM Personal Audio Rule');
  });

  it('enforces auth and template visibility on POST /api/template-director and returns structured fallback turn', async () => {
    routeMock.viewer.mockResolvedValueOnce({ userId: null, isAdmin: false, tier: 'anon' });
    const unauthForm = new FormData();
    unauthForm.set('template', 'runway-arrival');
    unauthForm.set('message', '자켓 검정으로 변경');
    const unauthRes = await directorPOST(
      new Request('https://twings.app/api/template-director', { method: 'POST', body: unauthForm }),
    );
    expect(unauthRes.status).toBe(401);

    const form = new FormData();
    form.set('template', 'runway-arrival');
    form.set('locale', 'ko');
    form.set('message', '블랙 레더 자켓으로 바꿔줘');
    form.set('audioMode', 'bgm');
    form.set('bgmMood', 'trendy_beat');
    const okRes = await directorPOST(
      new Request('https://twings.app/api/template-director', { method: 'POST', body: form }),
    );
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      ok: boolean;
      model: string;
      turn: { approved: boolean; summaryChips: Array<{ slot: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.model).toBe('heuristic');
    expect(body.turn.approved).toBe(true);
    expect(body.turn.summaryChips.some((c) => c.slot === 'outfit')).toBe(true);

    routeMock.loadPromptBySlug.mockResolvedValueOnce({
      id: 'tpl-brand',
      slug: 'brand-only',
      status: 'published',
      audience: 'brand',
    });
    const hiddenForm = new FormData();
    hiddenForm.set('template', 'brand-only');
    hiddenForm.set('message', '배경 바꿔줘');
    const notFoundRes = await directorPOST(
      new Request('https://twings.app/api/template-director', { method: 'POST', body: hiddenForm }),
    );
    expect(notFoundRes.status).toBe(404);
  });

  it('renders audio mode toggle, KRW-only selective frame summary, and person-protected vs downloadable refs', () => {
    const disclosedRecipe: PublicRecipe = {
      presentation: 'make-first',
      intro: '기본 카메라 워킹과 조명은 유지되고 의상·소품·무드만 바꿀 수 있어요.',
      outro: null,
      steps: [
        {
          n: 1,
          kind: 'video',
          engine: 'Seedance 2.5',
          inputs: [{ kind: 'selfie' }, { kind: 'reference', n: 1 }, { kind: 'reference', n: 2 }],
          prompt: 'Tracking shot',
          note: null,
        },
      ],
      files: [
        {
          n: 1,
          kind: 'image',
          href: '/api/makers/files/ast_11111111111111111111111111111111',
          download: null,
          containsPerson: true,
        },
        {
          n: 2,
          kind: 'image',
          href: '/api/makers/files/ast_22222222222222222222222222222222',
          download: '/api/makers/files/ast_22222222222222222222222222222222?download=1',
          containsPerson: false,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        templateId="runway-arrival"
        locale="ko"
        medium="video"
        pricingDisplayMode="krw"
        disclosedRecipe={disclosedRecipe}
        initialExpanded
        imageSetSpec={{
          perFrameProviderUsd: 0.04,
          totalFrames: 3,
        }}
      />,
    );

    expect(html).toContain('data-director-audio-toggle');
    expect(html).toContain('data-audio-mode-option="ambient"');
    expect(html).toContain('data-audio-mode-option="bgm"');
    expect(html).toContain('data-director-original-references');
    expect(html).toContain('data-reference-person-protected="1"');
    expect(html).toContain('화면 조회 전용 (인물 보호)');
    expect(html).not.toContain('data-reference-download="1"');
    expect(html).toContain('data-reference-download="2"');
    expect(html).toContain('/api/makers/files/ast_22222222222222222222222222222222?download=1');
    expect(html).not.toContain('크레딧');
    expect(html).not.toContain('RECIPE V2');
    expect(html).not.toContain('@Image');
  });
});
