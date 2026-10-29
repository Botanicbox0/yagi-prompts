import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { PublicRecipe } from '@/lib/recipes/public';
import { RecipeActions, RecipeActionsView } from '@/components/recipes/recipe-actions';
import { MakerRecipeHub } from '@/components/makers/recipe-hub';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels } from '@/components/prompts/labels';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * The creative's recipe hub (2026-10-29): a follower from the post sees, on the first screen, that the
 * prompt is public and can copy it (members) or sign up for it (visitors) or make the video — and no
 * surface claims an open recipe the template page would not show, or carries the members' prompt.
 */

const step = (n: number, prompt: string) => ({ n, kind: 'video' as const, prompt });
const recipe = (steps: PublicRecipe['steps']): PublicRecipe => ({ presentation: 'story-first', steps, files: null });
const base = { signinHref: '/ko/signin?next=%2Fko%2Ft%2Fgoldfish%23how', makeHref: '#make', shopOpen: true };
const enLabels = { ...en.makerRecipe.actions, copied: en.makerRecipe.how.copied };
const koLabels = { ...ko.makerRecipe.actions, copied: ko.makerRecipe.how.copied };

describe('the template page recipe actions', () => {
  it('gives a visitor one tap to the free sign-up and never carries the prompt in the HTML', () => {
    const html = renderToStaticMarkup(<RecipeActions steps={1} labels={enLabels} accessEndpoint="/api/renders/access?template=goldfish&locale=en" {...base} />);
    expect(html).toContain('data-template-recipe-actions');
    expect(html).toContain('data-recipe-signin');
    expect(html).toContain(en.makerRecipe.actions.copySignedOut);
    expect(html).toContain(`href="${base.signinHref}"`);
    expect(html).not.toContain('data-recipe-copy');
    expect(html).toContain('href="#make"');
    expect(html).toContain(en.makerRecipe.actions.make);
    expect(html).toContain(`${en.makerRecipe.actions.preview} ↓`);
  });

  it("copies a member's one-step prompt in one tap, and jumps to the recipe when there are several steps", () => {
    const one = renderToStaticMarkup(<RecipeActionsView steps={1} labels={enLabels} {...base} unlocked={recipe([step(1, '[My photo] among goldfish.')])} />);
    expect(one).toContain('data-recipe-copy');
    expect(one).toContain(en.makerRecipe.actions.copy);
    expect(one).not.toContain('data-recipe-signin');
    const many = renderToStaticMarkup(<RecipeActionsView steps={2} labels={enLabels} {...base} unlocked={recipe([step(1, 'a [My photo] sheet'), step(2, 'a film of [Step 1 result]')])} />);
    expect(many).not.toContain('data-recipe-copy');
    expect(many).toContain(en.makerRecipe.actions.full);
  });

  it('says making opens soon while the shop is closed, drops the make button when not for sale, and is absent without prompts', () => {
    const closed = renderToStaticMarkup(<RecipeActionsView steps={1} labels={koLabels} {...base} shopOpen={false} unlocked={null} />);
    expect(closed).toContain(ko.makerRecipe.actions.makeClosed);
    expect(closed).toContain(ko.makerRecipe.actions.bodyClosed);
    const unsold = renderToStaticMarkup(<RecipeActionsView steps={1} labels={koLabels} {...base} makeHref={null} unlocked={null} />);
    expect(unsold).not.toContain('data-recipe-make');
    expect(unsold).toContain(ko.makerRecipe.actions.bodyClosed);
    expect(renderToStaticMarkup(<RecipeActionsView steps={0} labels={koLabels} {...base} unlocked={null} />)).toBe('');
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
