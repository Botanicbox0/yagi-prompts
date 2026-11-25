import { stripTemplateLockBlocks } from './locks';
import { stripTemplateStylingBlocks } from './styling';

/**
 * docs/PERSONAL-STUDIO.md §3.3–§3.4.9 — a template's `Template locks:` and `Template styling:` blocks are declarations
 * for the compiler (and, through their public projections, for the screens), never copy a customer reads. Wherever a
 * customer is handed a template's prompt text — the prompt shaper, the copy decision, a public recipe on the template
 * page and in a member's full recipe (`/api/renders/access`) — it goes through here.
 *
 * Display only: the stored text and everything the compiler reads keep the blocks. A text with neither block is
 * returned as the same string, byte for byte.
 *
 * Client-safe.
 */
export function publicPromptText(text: string): string {
  return stripTemplateStylingBlocks(stripTemplateLockBlocks(text));
}

/**
 * A public recipe's step prompts without the two blocks; the same value when no step carries one (or there are no
 * steps). Everything but the step prompts is kept as it is.
 */
export function publicRecipeText<T extends { steps: ReadonlyArray<{ prompt: string }> | null }>(recipe: T | null): T | null {
  if (!recipe?.steps || recipe.steps.every((step) => publicPromptText(step.prompt) === step.prompt)) return recipe;
  return { ...recipe, steps: recipe.steps.map((step) => ({ ...step, prompt: publicPromptText(step.prompt) })) };
}
