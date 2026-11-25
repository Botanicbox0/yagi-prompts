import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { insertPrompt } from '@/lib/prompts/repo';
import { legacyPromptText, parseRecipe, type Recipe } from '@/lib/recipes/schema';

/**
 * docs/CREATOR-PLATFORM.md (2026-11-25) — an accepted format template the way the studio's maker-film import and the
 * format acceptance leave it: a `source='yagi'` row authored by the format's owner, `hidden` text, the recipe and the
 * page choices written BEFORE the `platform_formats` row links it (0059's guard freezes both from then on).
 *
 * Invented fixture data only (the repository is public): no production prompt, account or template.
 */

export const FIXTURE_FILM_PROMPT =
  'A slow push-in on {{selfie}} standing in a rain-lit alley, neon reflections on wet stone, the camera drifting left as the person turns toward the lens and smiles.';

export function filmRecipe(prompt = FIXTURE_FILM_PROMPT, extra: { note?: string; intro?: string } = {}): Recipe {
  const recipe = {
    version: 2,
    slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: [
      {
        id: 'film',
        kind: 'video',
        engine: 'seedance-2.5',
        inputs: ['selfie'],
        prompt,
        ...(extra.note !== undefined ? { note: extra.note } : {}),
        params: { aspect: '9:16', duration: 10, resolution: '720p' },
      },
    ],
    output: { from: 'film' },
    ...(extra.intro !== undefined ? { notes: { intro: extra.intro } } : {}),
  };
  const checked = parseRecipe(recipe);
  if (!checked.ok) throw new Error(`fixture recipe does not parse: ${JSON.stringify(checked.issues)}`);
  return recipe as Recipe;
}

/** `studioOnly`: checked against the studio's rules only (a recipe the maker's byte limit would refuse). */
export function carouselRecipe(prompts: readonly string[], options: { studioOnly?: boolean } = {}): Recipe {
  const steps = prompts.map((prompt, i) => ({ id: `frame${i + 1}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt, params: { aspect: '4:5' } }));
  const recipe = { version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true } }, steps, output: { frames: steps.map((s) => s.id) } };
  const checked = parseRecipe(recipe, { studio: options.studioOnly === true });
  if (!checked.ok) throw new Error(`fixture carousel does not parse: ${JSON.stringify(checked.issues)}`);
  return recipe as Recipe;
}

export interface FormatFixture {
  templateId: string;
  formatId: string;
  ownerId: string;
  slug: string;
  recipe: Recipe;
}

export async function seedFormatTemplate(
  sql: SqlRunner,
  options: {
    payout?: 'company' | 'external';
    recipe?: Recipe;
    slug?: string;
    status?: 'pending' | 'published';
    disclosure?: { prompts: boolean; assets: boolean };
    priceKrw?: number;
    formatRecipeText?: 'film-prompt' | 'empty';
    ownerId?: string;
  } = {},
): Promise<FormatFixture> {
  const ownerId = options.ownerId ?? randomUUID();
  if (options.ownerId === undefined) {
    await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [ownerId]);
    await sql.query('insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing', [ownerId, `owner-${ownerId.slice(0, 8)}@example.test`]);
    await sql.query(
      `insert into platform_creators (user_id, active, contract_version, payout) values ($1, true, 'fixture-v1', $2)
       on conflict (user_id) do update set payout = excluded.payout`,
      [ownerId, options.payout ?? 'company'],
    );
  }
  const recipe = options.recipe ?? filmRecipe();
  const checked = parseRecipe(recipe, { studio: true });
  if (!checked.ok) throw new Error('fixture recipe must parse');
  const primary = checked.recipe.steps.find((s) => s.id === ('from' in checked.recipe.output ? checked.recipe.output.from : checked.recipe.output.frames[0]))!;
  const templateId = randomUUID();
  const slug = options.slug ?? `format-fixture-${templateId.slice(0, 8)}`;
  const film = primary.kind === 'video' ? primary : null;
  await insertPrompt(sql, {
    id: templateId,
    slug,
    source: 'yagi',
    authorId: ownerId,
    authorHandle: null,
    status: options.status ?? 'published',
    models: [primary.engine],
    title: 'Rain alley fixture',
    titleKo: '비 오는 골목 예시',
    promptText: legacyPromptText(checked.recipe),
    textVisibility: 'hidden',
    media: null,
    useCase: [],
    featured: false,
    medium: primary.kind,
    priceKrw: options.priceKrw ?? 24_900,
    priceCents: 1779,
    runtimeSeconds: film ? film.params.duration : null,
    engine: primary.engine,
    aspectDefault: primary.params.aspect,
    publishedAt: (options.status ?? 'published') === 'published' ? 'now' : null,
  });
  await sql.query('update prompt_items set recipe = $2::jsonb, disclosure = $3::jsonb where id = $1', [
    templateId,
    JSON.stringify(recipe),
    JSON.stringify(options.disclosure ?? { prompts: true, assets: false }),
  ]);
  const formatId = randomUUID();
  await sql.query(
    `insert into platform_formats (id, user_id, title, recipe, medium, status, template_id, recipe_v2, disclosure, royalty_krw)
     values ($1, $2, 'Rain alley fixture', $3, $4, 'accepted', $5, $6::jsonb, $7::jsonb, 0)`,
    [
      formatId,
      ownerId,
      options.formatRecipeText === 'empty' ? '' : recipe.steps[0]!.prompt,
      primary.kind,
      templateId,
      JSON.stringify(recipe),
      JSON.stringify(options.disclosure ?? { prompts: true, assets: false }),
    ],
  );
  return { templateId, formatId, ownerId, slug, recipe };
}
