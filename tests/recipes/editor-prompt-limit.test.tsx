import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecipeEditor, toRecipe, type EditorDraft } from '@/components/recipes/recipe-editor';
import { ko } from '@/messages/ko';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes 15,000 characters per clip. The editor's counter and the field's
 * `maxLength` follow the step's own engine; a text longer than a newly picked engine allows is kept as written and
 * flagged (the over state and the checks list), never cut.
 */

const label = { selfie: '[내 사진]', reference: (n: number) => `[참조 ${n}]`, step: (n: number) => `[${n}단계 결과]` };
const engines = [
  { id: 'gpt-image-2', label: 'GPT IMAGE 2', kind: 'image' as const },
  { id: 'seedance-2.5', label: 'SEEDANCE 2.5', kind: 'video' as const, minDuration: 4, maxDuration: 30, resolutions: ['720p', '1080p'] },
  { id: 'seedance-2.0', label: 'SEEDANCE 2.0', kind: 'video' as const, minDuration: 4, maxDuration: 15, resolutions: ['720p'] },
];

function render(filmEngine: string, filmChars: number): string {
  const still = { kind: 'image' as const, engine: 'gpt-image-2', text: '[내 사진]의 인물이 창가에 선 스틸.', aspect: '9:16', duration: 10, resolution: '720p' as const };
  const head = '[1단계 결과]의 인물이 걷는다. ';
  const film = { kind: 'video' as const, engine: filmEngine, text: `${head}${'가'.repeat(filmChars - head.length)}`, aspect: '9:16', duration: 10, resolution: '720p' as const };
  const recipe = toRecipe([still, film], 'video', [], label);
  const draft: EditorDraft = { status: 'draft', title: 'Long film', titleKo: null, recipe, exampleUrl: null, disclosure: { prompts: false, assets: false }, presentation: 'make-first', royaltyKrw: 300, testRendersUsed: 0, files: [], tests: [], revisionOf: null };
  return renderToString(<RecipeEditor copy={ko.makerRecipe} formatId="11111111-1111-4111-8111-111111111111" draft={draft} engines={engines}
    aspects={{ image: ['9:16'], video: ['9:16'] }} hasSelfie testLimit={3} selfieHref="/identity/selfie" workspaceHref="/creators/workspace" locale="ko" />);
}

const counters = (html: string) => [...html.matchAll(/data-recipe-prompt-count="(\d+)" data-recipe-prompt-limit="(\d+)"( data-over="true")?/g)]
  .map((m) => ({ written: Number(m[1]), limit: Number(m[2]), over: Boolean(m[3]) }));

describe('recipe editor prompt limit', () => {
  it('counts each step against its own engine: 8,000 for the image, 15,000 for a Seedance 2.5 clip', () => {
    // The editor's [1단계 결과] becomes {{step1}} in the recipe, so the stored prompt is a little longer than the text.
    const html = render('seedance-2.5', 12_000);
    expect(html).toMatch(/maxlength="8000"/i);
    expect(html).toMatch(/maxlength="15000"/i);
    const [still, film] = counters(html);
    expect(still).toMatchObject({ limit: 8_000, over: false });
    expect(film).toMatchObject({ limit: 15_000, over: false });
    expect(film!.written).toBeGreaterThan(12_000);
    expect(html).toContain('/ 15,000자');
    expect(html).toContain(ko.makerRecipe.checksOk);
  });

  it('keeps a long text whole and flags it when the step moves to an engine with a lower limit', () => {
    const html = render('seedance-2.0', 12_000);
    const [, film] = counters(html);
    expect(film).toMatchObject({ limit: 8_000, over: true });
    expect(html).toMatch(/aria-invalid="true"/);
    // Not cut: the whole text is still in the field.
    expect(html).toContain('가'.repeat(11_000));
    expect(html).not.toContain(ko.makerRecipe.checksOk);
    expect(html).toContain(ko.makerRecipe.issues.shape);
  });
});
