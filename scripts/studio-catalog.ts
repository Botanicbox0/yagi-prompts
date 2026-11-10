/**
 * `npm run studio:catalog` — is every brand studio model still on Sunra, and is there a new
 * Seedream/Seedance we have not registered yet (docs/BRAND-STUDIO-V2.md §4: this is how Seedream 5.5
 * gets noticed)?
 *
 * Read-only: one public GET of the Sunra catalogue (`/v1/models`, no key needed). Spends nothing and
 * prints no secrets. Exit code 1 when a `live` model is missing from the catalogue.
 */
import { STUDIO_MODELS } from '../lib/brand-studio/models';

const CATALOGUE = 'https://api.sunra.ai/v1/models?limit=300';
const WATCHED = /^bytedance\/seed(?:ream|ance)-/;

interface CatalogueModel {
  id?: string;
  alias?: string;
  endpoints?: Array<{ name?: string }>;
}

async function main(): Promise<void> {
  const response = await fetch(CATALOGUE, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`catalogue answered ${response.status}`);
  const body = (await response.json()) as { data?: CatalogueModel[]; has_more?: boolean };
  const listed = new Map<string, CatalogueModel>();
  for (const model of body.data ?? []) if (model.alias) listed.set(model.alias, model);

  console.log(`Sunra catalogue: ${listed.size} models${body.has_more ? ' (more pages exist; only the first 300 were read)' : ''}\n`);
  let missingLive = 0;
  for (const model of STUDIO_MODELS) {
    const hit = listed.get(model.api.alias);
    const wanted = Object.values(model.endpoints);
    const endpoints = new Set((hit?.endpoints ?? []).map((e) => e.name).filter(Boolean));
    const lacking = hit ? wanted.filter((e) => !endpoints.has(e)) : wanted;
    const state = hit ? (lacking.length ? `listed, missing endpoints: ${lacking.join(', ')}` : 'listed') : 'NOT LISTED';
    if (!hit && model.availability === 'live') missingLive += 1;
    const note = !hit && model.availability === 'awaiting_provider' ? ' (awaiting provider: expected)' : hit && model.availability === 'awaiting_provider' ? ' <- now listed: re-read its schema, then set availability to live' : '';
    console.log(`  ${model.id.padEnd(18)} ${model.availability.padEnd(18)} ${model.api.alias.padEnd(32)} ${state}${note}`);
  }

  const registered = new Set<string>(STUDIO_MODELS.map((m) => m.api.alias));
  const fresh = [...listed.keys()].filter((alias) => WATCHED.test(alias) && !registered.has(alias)).sort();
  console.log(`\nSeedream / Seedance aliases on Sunra that the registry does not have: ${fresh.length}`);
  for (const alias of fresh) console.log(`  ${alias}  (${listed.get(alias)?.id ?? '?'})`);

  if (missingLive > 0) {
    console.error(`\n${missingLive} live model(s) are not in the catalogue.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`studio:catalog failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
