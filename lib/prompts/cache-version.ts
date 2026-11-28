/**
 * Shared prompt catalog data-cache version, kept in a pure leaf module so sibling cache wrappers
 * (`cached-by-slugs.ts`) never pull in or break partial `vi.mock('@/lib/prompts/public-catalog')` stubs.
 */
export const PROMPT_CATALOG_CACHE_VERSION = 'v19-catalog-listed';
