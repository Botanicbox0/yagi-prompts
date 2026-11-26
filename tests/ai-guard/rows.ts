/**
 * The proof table of the prompt guard (docs/PROMPT-GUARD.md "Adding a row"): ONE ROW PER ADOPTED CALL SITE.
 * Every row is run by harness.test.ts (enforce / observe / benign), system-part.test.ts (no customer text
 * in the system part) and reference-sites-off.test.ts (off = the bytes origin/main sent and answered).
 * inventory.test.ts fails when a model call in lib/ or app/ is neither a row here nor on NOT_YET_ADOPTED.
 *
 * A row says how to run its site with a fake `fetch` and which of the answer's texts leave the server
 * (shown, stored or sent). A later slice adds its row here and its cases next to it.
 */
import { REFERENCE_CASES, runSite, type ReferenceCase } from './reference-cases';

export interface SiteOutcome {
  /** Every free-text field of the site's answer that is shown, stored or sent, by name. */
  shown: Record<string, string>;
  /** `model` when the model's words went out, `fallback` when the site answered its fallback. */
  source: string;
  /** The whole answer, for equality with the site's own fallback. */
  answer: unknown;
}

export interface GuardRow {
  /** The `site` id the row's `guardRequest` call uses. */
  site: string;
  /** Sites whose log lines this row may write (a site that delegates to another writer logs as that one). */
  logSites: readonly string[];
  /** Audit numbers (AUDIT.md §1.2). */
  audit: string;
  /** The adopted file (inventory.test.ts checks it is the file with the call). */
  file: string;
  cases: readonly ReferenceCase[];
  /** Runs one case; never throws. */
  run(c: ReferenceCase, env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<SiteOutcome>;
  /**
   * What the `off` snapshot records for one case (reference-sites-off.test.ts): the site's whole answer.
   * The snapshot must be written on origin/main BEFORE the site is adopted (docs/PROMPT-GUARD.md "Adding a row").
   */
  record(c: ReferenceCase, env: Record<string, string | undefined>, fetchImpl: typeof fetch, onFallback: (reason: string) => void): Promise<unknown>;
}

async function studioOutcome(c: ReferenceCase, env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<SiteOutcome> {
  const result = await runSite(c, env, fetchImpl);
  return {
    shown: { prompt: result.prompt, notes: result.notes },
    source: result.source,
    answer: { prompt: result.prompt, notes: result.notes, source: result.source },
  };
}

export const ROWS: readonly GuardRow[] = [
  {
    site: 'brand-studio.enhancer',
    logSites: ['brand-studio.enhancer'],
    audit: '#1 (Prompt Architect: 설계 preview and job prepare)',
    file: 'lib/brand-studio/enhancer/index.ts',
    cases: REFERENCE_CASES.filter((c) => c.site === 'brand-studio.enhancer'),
    run: studioOutcome,
    record: runSite,
  },
  {
    site: 'brand-studio.director',
    // A clip revision and a still image go from the director to the enhancer, which then logs as itself.
    logSites: ['brand-studio.director', 'brand-studio.enhancer'],
    audit: '#2 (Seedance director: 설계 preview and job prepare)',
    file: 'lib/brand-studio/director/compiler.ts',
    cases: REFERENCE_CASES.filter((c) => c.site === 'brand-studio.director'),
    run: studioOutcome,
    record: runSite,
  },
];
