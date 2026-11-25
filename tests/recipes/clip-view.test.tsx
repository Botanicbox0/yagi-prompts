import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClipCard } from '@/components/recipes/clip-card';
import { ClipIndex, CLIP_INDEX_MIN } from '@/components/recipes/clip-index';
import { HowItWasMade } from '@/components/recipes/how-it-was-made';
import { RecipeClipsSection } from '@/components/recipes/recipe-clips-section';
import { recipeTeaser, type PublicRecipe } from '@/lib/recipes/public';
import { ko } from '@/messages/ko';

const mr = ko.makerRecipe;
const h = mr.how;

const LONG_TEXT = `[내 사진]의 인물이 빗물이 고인 보도블록 위를 천천히 걸어가는 장면. ${'렌즈에 빗방울이 맺히고 가로등 불빛이 길게 번진다. '.repeat(14)}`;

function makeClips(count: number) {
  return Array.from({ length: count }, (_, idx) => {
    const n = idx + 1;
    return {
      n,
      title: `가상 장면 ${n}`,
      kind: (n === 1 ? 'image' : 'video') as 'image' | 'video',
      meta: `META_SECRET_${n} · 4:3 · 5초`,
      prompt: `PROMPT_SECRET_${n} · ${LONG_TEXT}`,
      note: `NOTE_SECRET_${n} · 정면 시선을 유지하면 자연스럽습니다.`,
    };
  });
}

describe('recipeTeaser — clip outline and guideless identity rule', () => {
  it('exposes only clip numbers and titles in guideOutline and leaks no meta, prompt, or tip', () => {
    const full: PublicRecipe = {
      presentation: 'story-first',
      intro: '가상 소개 문장.',
      outro: 'OUTRO_SECRET',
      steps: [
        {
          n: 1,
          kind: 'video',
          engine: 'SEEDANCE 2.5',
          inputs: [{ kind: 'selfie' }],
          prompt: `Opening line. ${'More detail. '.repeat(25)}STEP_SECRET`,
          note: 'STEP_TIP_SECRET',
        },
      ],
      guide: makeClips(4),
      files: null,
    };

    const teaser = recipeTeaser(full)!;
    expect('guide' in teaser).toBe(false);
    expect(teaser.guideOutline).toEqual([
      { n: 1, title: '가상 장면 1' },
      { n: 2, title: '가상 장면 2' },
      { n: 3, title: '가상 장면 3' },
      { n: 4, title: '가상 장면 4' },
    ]);

    const json = JSON.stringify(teaser);
    expect(json).not.toContain('META_SECRET');
    expect(json).not.toContain('PROMPT_SECRET');
    expect(json).not.toContain('NOTE_SECRET');
    expect(json).not.toContain('STEP_TIP_SECRET');
    expect(json).not.toContain('OUTRO_SECRET');
  });

  it('keeps guideless recipe teaser keys and output identical to main', () => {
    const guideless: PublicRecipe = {
      presentation: 'make-first',
      intro: '짧은 소개.',
      outro: '마무리 글.',
      steps: [
        {
          n: 1,
          kind: 'image',
          engine: 'GPT IMAGE 2',
          inputs: [{ kind: 'selfie' }],
          prompt: 'Short opening line [BGM soft strings]',
          note: '회원 팁.',
        },
      ],
      files: [{ n: 1, kind: 'image', href: '/api/makers/files/ast_0123456789abcdef0123456789abcdef', download: null }],
    };

    const teaser = recipeTeaser(guideless)!;
    expect(Object.keys(teaser)).toEqual(['presentation', 'intro', 'outro', 'steps', 'files']);
    expect('guideOutline' in teaser).toBe(false);
    expect('guide' in teaser).toBe(false);
    expect(teaser).toEqual({
      presentation: 'make-first',
      intro: '짧은 소개.',
      outro: null,
      steps: [
        {
          n: 1,
          kind: 'image',
          engine: 'GPT IMAGE 2',
          inputs: [{ kind: 'selfie' }],
          prompt: 'Short opening line [BGM soft strings]…\n\n[BGM soft strings]',
          note: null,
        },
      ],
      files: null,
    });
  });

  it('keeps guideless HowItWasMade free of clips section, clips link, and bulk toggle for single step', () => {
    const html = renderToStaticMarkup(
      <HowItWasMade
        recipe={{
          presentation: 'story-first',
          intro: null,
          outro: null,
          steps: [
            {
              n: 1,
              kind: 'video',
              engine: 'SEEDANCE 2.5',
              inputs: [{ kind: 'selfie' }],
              prompt: LONG_TEXT,
              note: '단계 팁 문장.',
            },
          ],
          files: null,
        }}
        copy={mr}
      />,
    );

    expect(html).not.toContain('data-recipe-clips');
    expect(html).not.toContain('data-recipe-clips-link');
    expect(html).not.toContain('data-recipe-guide');
    expect(html).not.toContain('data-recipe-clip-index');
    expect(html).not.toContain('data-recipe-toggle-all');
  });

  it('bumps the cached public recipe key past public-recipe-v8', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'recipes', 'cached-public.ts'), 'utf8');
    expect(src).toContain('public-recipe-v9');
    expect(src).not.toContain("['public-recipe-v8'");
  });
});

describe('ClipCard & HowItWasMade layout', () => {
  it('renders number + title → meta → tip box ABOVE folded prompt → copy', () => {
    const html = renderToStaticMarkup(
      <ol>
        <ClipCard
          id="clip-1"
          number={1}
          title="첫 클립 제목"
          meta="영상 · 4:3 · 5초"
          note="카메라가 지나간 뒤 인물만 남기세요."
          noteMarker="guide"
          prompt={LONG_TEXT}
          labels={{
            tipHeading: h.tipHeading,
            expand: h.expand,
            collapse: h.collapse,
            copy: h.copy,
            copied: h.copied,
          }}
          itemAttr={{ 'data-recipe-guide-step': 1 }}
        />
      </ol>,
    );

    const titleAt = html.indexOf('첫 클립 제목');
    const metaAt = html.indexOf('영상 · 4:3 · 5초');
    const tipHeadingAt = html.indexOf(`>${h.tipHeading}<`);
    const tipNoteAt = html.indexOf('data-recipe-guide-note');
    const promptAt = html.indexOf('data-recipe-prompt="folded"');
    const expandAt = html.indexOf('data-recipe-expand');

    expect(titleAt).toBeGreaterThan(-1);
    expect(metaAt).toBeGreaterThan(titleAt);
    expect(tipNoteAt).toBeGreaterThan(metaAt);
    expect(tipHeadingAt).toBeGreaterThan(metaAt);
    expect(promptAt).toBeGreaterThan(tipNoteAt);
    expect(expandAt).toBeGreaterThan(promptAt);
    expect(html).toContain('data-clip-number');
    expect(html).toContain('>01<');
    expect(html).toContain('data-recipe-copy');
    expect(html).not.toMatch(/#3875c5|#3063a7|#0033ff|#ed1e1e/i);
  });

  it('omits the duplicate number pill on execution step cards in HowItWasMade while keeping it on clip cards', () => {
    const recipe: PublicRecipe = {
      presentation: 'make-first',
      intro: null,
      outro: null,
      steps: [
        {
          n: 1,
          kind: 'video',
          engine: 'SEEDANCE 2.5',
          inputs: [],
          prompt: '짧은 단계 프롬프트.',
          note: null,
        },
      ],
      guide: makeClips(1),
      files: null,
    };

    const howHtml = renderToStaticMarkup(<HowItWasMade recipe={recipe} copy={mr} clipsHref="#clips" />);
    expect(howHtml).toContain('1단계 · 영상');
    expect(howHtml).not.toContain('data-clip-number');
    expect(howHtml).not.toContain('>01<');

    const clipsHtml = renderToStaticMarkup(<RecipeClipsSection recipe={recipe} copy={mr} />);
    expect(clipsHtml).toContain('data-clip-number');
    expect(clipsHtml).toContain('>01<');
  });

  it('folds long step prompts and places step tips above prompts in BOTH compact and default HowItWasMade', () => {
    const recipe: PublicRecipe = {
      presentation: 'make-first',
      intro: '도입 문구.',
      outro: '마무리 문구.',
      steps: [
        {
          n: 1,
          kind: 'video',
          engine: 'SEEDANCE 2.5',
          inputs: [],
          prompt: LONG_TEXT,
          note: '단계 팁 우선 노출',
        },
      ],
      files: null,
    };

    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(<HowItWasMade recipe={recipe} copy={mr} compact={compact} />);
      expect(html).toContain('data-recipe-prompt="folded"');
      expect(html).toContain('data-recipe-expand');
      expect(html.indexOf('data-recipe-note')).toBeLessThan(html.indexOf('data-recipe-prompt="folded"'));
    }
  });

  it('shows a single jump link in HowItWasMade when clipsHref is provided', () => {
    const recipe: PublicRecipe = {
      presentation: 'story-first',
      intro: '소개.',
      outro: null,
      steps: [{ n: 1, kind: 'video', engine: 'SEEDANCE 2.5', inputs: [], prompt: '짧은 단계 프롬프트.', note: null }],
      guide: makeClips(9),
      files: null,
    };
    const unlockedHtml = renderToStaticMarkup(<HowItWasMade recipe={recipe} copy={mr} clipsHref="#clips" />);
    expect(unlockedHtml).toContain('data-recipe-clips-link');
    expect(unlockedHtml).toContain('클립별 프롬프트 9개 보기');
    expect(unlockedHtml).not.toContain('data-recipe-guide-step');

    const teaser = recipeTeaser(recipe)!;
    const lockedHtml = renderToStaticMarkup(
      <HowItWasMade
        recipe={teaser}
        copy={mr}
        compact
        clipsHref="#clips"
        gate={{ accessEndpoint: '/api/renders/access?template=x', signinHref: '/ko/signin' }}
      />,
    );
    expect(lockedHtml).toContain('data-recipe-clips-link');
    expect(lockedHtml).toContain('클립별 프롬프트 9개 보기');
  });
});

describe('ClipIndex & RecipeClipsSection', () => {
  it('does not render ClipIndex when fewer than 3 cards', () => {
    expect(CLIP_INDEX_MIN).toBe(3);
    const items = [
      { id: 'clip-1', n: 1, title: '첫 클립' },
      { id: 'clip-2', n: 2, title: '둘째 클립' },
    ];
    expect(
      renderToStaticMarkup(
        <ClipIndex items={items} activeId="clip-1" onSelect={() => {}} label={h.clipIndexLabel} variant="rail" />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <ClipIndex items={items} activeId="clip-1" onSelect={() => {}} label={h.clipIndexLabel} variant="chips" />,
      ),
    ).toBe('');
  });

  it('renders both rail and chips ClipIndex when 3 or more cards', () => {
    const items = makeClips(9).map((c) => ({ id: `clip-${c.n}`, n: c.n, title: c.title }));
    const rail = renderToStaticMarkup(
      <ClipIndex items={items} activeId="clip-3" onSelect={() => {}} label={h.clipIndexLabel} variant="rail" />,
    );
    const chips = renderToStaticMarkup(
      <ClipIndex items={items} activeId="clip-3" onSelect={() => {}} label={h.clipIndexLabel} variant="chips" />,
    );
    expect(rail).toContain('data-recipe-clip-index="rail"');
    expect(rail).toContain('href="#clip-9"');
    expect(rail).toContain('data-clip-index-item="3" data-active="true"');
    expect(chips).toContain('data-recipe-clip-index="chips"');
    expect(chips).toContain('href="#clip-9"');
  });

  it('renders all 9 clip cards, bulk toggle, and index in unlocked RecipeClipsSection', () => {
    const full: PublicRecipe = {
      presentation: 'story-first',
      intro: null,
      outro: null,
      steps: [{ n: 1, kind: 'video', engine: 'SEEDANCE 2.5', inputs: [], prompt: '요약 프롬프트.', note: null }],
      guide: makeClips(9),
      files: null,
    };

    const html = renderToStaticMarkup(<RecipeClipsSection recipe={full} copy={mr} />);
    expect(html).toContain('id="clips"');
    expect(html).toContain('data-recipe-clips');
    expect(html).toContain('data-recipe-guide');
    expect(html).toContain('data-recipe-toggle-all');
    expect(html).toContain(h.expandAll);
    expect(html).toContain('data-recipe-clip-index="chips"');
    expect(html).toContain('data-recipe-clip-index="rail"');
    expect(html.match(/data-recipe-guide-step=/g)).toHaveLength(9);
    expect(html.indexOf('data-recipe-guide-note')).toBeLessThan(html.indexOf('data-recipe-prompt="folded"'));
  });

  it('renders title-only outline + gate for signed-out visitors in RecipeClipsSection', () => {
    const full: PublicRecipe = {
      presentation: 'story-first',
      intro: null,
      outro: null,
      steps: [{ n: 1, kind: 'video', engine: 'SEEDANCE 2.5', inputs: [], prompt: '요약 프롬프트.', note: null }],
      guide: makeClips(9),
      files: null,
    };
    const teaser = recipeTeaser(full)!;

    const html = renderToStaticMarkup(
      <RecipeClipsSection
        recipe={teaser}
        copy={mr}
        gate={{ accessEndpoint: '/api/renders/access?template=x', signinHref: '/ko/signin' }}
      />,
    );
    expect(html).toContain('id="clips"');
    expect(html).toContain('data-recipe-clips');
    expect(html).toContain('data-recipe-gate');
    expect(html).toContain('가상 장면 1');
    expect(html).toContain('가상 장면 9');
    expect(html).not.toContain('META_SECRET');
    expect(html).not.toContain('PROMPT_SECRET');
    expect(html).not.toContain('NOTE_SECRET');
    expect(html).not.toContain('data-recipe-guide-step');
  });
});
