import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecipeEditor, fromRecipe, toRecipe, type EditorFile } from '@/components/recipes/recipe-editor';
import { parseRecipe } from '@/lib/recipes/schema';
import { ko } from '@/messages/ko';

/** The editor's readable references ([내 사진], [참조 1], [1단계 결과]) ⇄ the §7.3 tokens. */
const label = { selfie: '[내 사진]', reference: (n: number) => `[참조 ${n}]`, step: (n: number) => `[${n}단계 결과]` };
const files: EditorFile[] = [{ id: `ast_${'a'.repeat(32)}`, role: 'reference', kind: 'image', mime: 'image/jpeg' }, { id: `ast_${'b'.repeat(32)}`, role: 'example', kind: 'image', mime: 'image/jpeg' }];

describe('recipe editor', () => {
  it('turns readable references into a recipe that passes, and back', () => {
    const steps = [
      { kind: 'image' as const, engine: 'gpt-image-2', text: '[내 사진]의 캐릭터 시트, 정면과 측면.', aspect: '16:9', duration: 10, resolution: '720p' as const },
      { kind: 'video' as const, engine: 'seedance-2.5', text: '[1단계 결과]의 인물이 [참조 1]을 들고 걷는다.', aspect: '9:16', duration: 10, resolution: '720p' as const },
    ];
    const recipe = toRecipe(steps, 'video', files.filter((f) => f.role === 'reference'), label);
    const checked = parseRecipe(recipe);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    expect(recipe.steps[1]).toMatchObject({ inputs: ['step1', 'ref1'], prompt: '{{step1}}의 인물이 {{ref1}}을 들고 걷는다.' });
    expect(recipe.slots).toEqual({ selfie: { kind: 'image', source: 'user', required: true }, ref1: { kind: 'image', source: 'creator', asset: files[0]!.id } });
    const back = fromRecipe(recipe, files, label)!;
    expect(back.medium).toBe('video');
    expect(back.steps.map((s) => s.text)).toEqual(steps.map((s) => s.text));
    expect(back.missingFile).toBe(false);
    expect(fromRecipe(recipe, [], label)!.missingFile).toBe(true);
    expect(fromRecipe('not json', files, label)).toBeNull();
  });

  it('renders the split editor with its markers on the server', () => {
    const html = renderToString(<RecipeEditor copy={ko.makerRecipe} formatId="11111111-1111-4111-8111-111111111111" draft={null}
      engines={[{ id: 'gpt-image-2', label: 'GPT IMAGE 2', kind: 'image' }, { id: 'seedance-2.5', label: 'SEEDANCE 2.5', kind: 'video', minDuration: 4, maxDuration: 30, resolutions: ['720p', '1080p'] }]}
      aspects={{ image: ['4:5'], video: ['9:16'] }} hasSelfie={false} selfieHref="/identity/selfie" workspaceHref="/creators/workspace" testLimit={3} locale="ko" />);
    for (const marker of ['data-recipe-editor', 'data-recipe-step="step1"', 'data-recipe-files', 'data-recipe-preview', 'data-recipe-test', 'data-recipe-issues', 'data-recipe-royalty']) expect(html).toContain(marker);
    expect(html).toContain(ko.makerRecipe.testNeedsSelfie);
    expect(html).toContain('[내 사진]');
  });
});
