import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { PublicRecipe } from '@/lib/recipes/public';
import { RecipeActions } from '@/components/recipes/recipe-actions';
import { MakerRecipeHub } from '@/components/makers/recipe-hub';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels } from '@/components/prompts/labels';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * The creative's recipe hub (2026-10-29): a follower from the post sees, on the first screen, that the
 * prompt is public and can copy it or make the video — and no surface claims an open recipe the
 * template page would not show.
 */

const step = (n: number, prompt: string) => ({ n, kind: 'video' as const, prompt });
const recipe = (steps: PublicRecipe['steps']): PublicRecipe => ({ presentation: 'story-first', steps, files: null });

describe('the template page recipe actions', () => {
  it('copies a one-step prompt in one tap and sends the make button to the make card', () => {
    const html = renderToStaticMarkup(<RecipeActions recipe={recipe([step(1, '[My photo] among goldfish.')])} copy={en.makerRecipe} makeHref="#make" shopOpen />);
    expect(html).toContain('data-template-recipe-actions');
    expect(html).toContain('data-recipe-copy');
    expect(html).toContain(en.makerRecipe.actions.copy);
    expect(html).toContain('href="#make"');
    expect(html).toContain(en.makerRecipe.actions.make);
    expect(html).toContain(en.makerRecipe.actions.body);
    expect(html).toContain('href="#recipe"');
  });

  it('says making opens soon while the shop is closed, and drops the make button when not for sale', () => {
    const closed = renderToStaticMarkup(<RecipeActions recipe={recipe([step(1, '[내 사진]과 금붕어.')])} copy={ko.makerRecipe} makeHref="#make" shopOpen={false} />);
    expect(closed).toContain(ko.makerRecipe.actions.makeClosed);
    expect(closed).toContain(ko.makerRecipe.actions.bodyClosed);
    const unsold = renderToStaticMarkup(<RecipeActions recipe={recipe([step(1, '[내 사진]과 금붕어.')])} copy={ko.makerRecipe} makeHref={null} shopOpen />);
    expect(unsold).not.toContain('data-recipe-make');
    expect(unsold).toContain(ko.makerRecipe.actions.bodyClosed);
  });

  it('jumps to the full recipe instead of copying when there are several steps, and is absent without prompts', () => {
    const many = renderToStaticMarkup(<RecipeActions recipe={recipe([step(1, 'a [My photo] sheet'), step(2, 'a film of [Step 1 result]')])} copy={en.makerRecipe} makeHref="#make" shopOpen />);
    expect(many).not.toContain('data-recipe-copy');
    expect(many).toContain('data-recipe-jump');
    expect(renderToStaticMarkup(<RecipeActions recipe={recipe(null)} copy={en.makerRecipe} makeHref="#make" shopOpen />)).toBe('');
  });
});

describe("the maker page's recipe line", () => {
  it('names the page as the creative\'s own and counts the open recipes', () => {
    const html = renderToStaticMarkup(<MakerRecipeHub handle="yunseolfromseoul" openRecipes={2} copy={ko.makers} />);
    expect(html).toContain('data-maker-recipe-hub');
    expect(html).toContain('@yunseolfromseoul');
    expect(html).toContain('공개한 레시피 2편');
  });

  it('is absent for a maker with no open recipe', () => {
    expect(renderToStaticMarkup(<MakerRecipeHub handle="jun" openRecipes={0} copy={ko.makers} />)).toBe('');
  });
});

describe('the card recipe pill', () => {
  const card = (recipeOpen?: boolean): PromptCard => ({
    id: 'x', slug: 'aquarium-goldfish-daydream', title: 'Aquarium Goldfish Daydream', titleKo: '어항 속 금붕어 백일몽', authorHandle: 'yunseolfromseoul',
    origin: 'maker', makerProfile: true, source: 'yagi', models: [], modelLabels: [], useCase: [], medium: 'video', priceCents: 293, priceKrw: 4100,
    price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 10, engine: 'seedance-2.5', aspectDefault: '4:3', poster: null, video: null, lock: null,
    featured: false, publishedAt: '2026-10-29T00:00:00.000Z', ...(recipeOpen === undefined ? {} : { recipeOpen }),
  });

  it('shows only on a card whose page shows the prompt', () => {
    const labels = promptLabels(ko);
    expect(renderToStaticMarkup(<PromptCardView card={card(true)} locale="ko" labels={labels} />)).toContain('data-card-recipe');
    expect(renderToStaticMarkup(<PromptCardView card={card(true)} locale="ko" labels={labels} />)).toContain('레시피 공개');
    expect(renderToStaticMarkup(<PromptCardView card={card(false)} locale="ko" labels={labels} />)).not.toContain('data-card-recipe');
    expect(renderToStaticMarkup(<PromptCardView card={card()} locale="ko" labels={labels} />)).not.toContain('data-card-recipe');
  });
});
