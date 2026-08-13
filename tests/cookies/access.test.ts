import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { Tier } from '@/lib/content/visibility';
import { unlockPrompt } from '@/lib/cookies/repo';
import { authorizePromptCopy, shapePromptDetail } from '@/lib/prompts/access';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { PROMPT_SENTINELS } from '../../scripts/prompt-fixtures';
import { viewerOf } from '../helpers/admin';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §15 — the cookies extension of the §13.2 gate.
 *
 * The doctrine is one sentence: text is visible iff admin, OR the dormant `pro` tier, OR an unlock
 * row exists for (account, prompt). Everything else — community-is-free, moderation-404s, the
 * no-teaser lock panel — is §13 unchanged, and `tests/prompts/access.test.ts` keeps asserting it.
 * What this file adds is the third clause and the §15.3 funnel the locked page now carries.
 */

const GATED = 'neon-alley-dolly'; // yagi, pro
const GATED_2 = 'handheld-market-run'; // yagi, pro — the "unlock elsewhere opens nothing" control
const TEASER = 'static-portrait-window-light'; // yagi, public
const COMMUNITY = 'skate-park-golden-hour'; // community, public

const sentinelFor = (slug: string) => PROMPT_SENTINELS.find((s) => s.slug === slug)!.token;

describe('unlock-aware prompt access (§15)', () => {
  let harness: PromptHarness;
  const sql = () => harness.sql;
  const deps = (viewer: Viewer) => ({ sql: sql(), viewer });

  const idOf = async (slug: string) => (await loadPromptBySlug(sql(), slug))!.id;

  const setWallet = async (userId: string, balance: number, grantedAgo: string | null) => {
    await sql().query(
      `update profiles
          set cookie_balance = $2,
              cookies_granted_at = case when $3::text is null then null
                                        else now() - $3::interval end
        where id = $1`,
      [userId, balance, grantedAgo],
    );
  };

  beforeEach(async () => {
    harness = await promptHarness();
    // Pin every fixture wallet: stamped now, so the lazy grant stays out of assertions that are
    // not about it. The grant itself is exercised explicitly below and in tests/cookies/repo.
    for (const user of Object.values(FIXTURE_USERS)) {
      await setWallet(user.id, 3, '1 hour');
    }
  });
  afterEach(async () => harness.close());

  // -------------------------------------------------------------------------
  // the §15.3 panel matrix
  // -------------------------------------------------------------------------

  it('offers anon the sign-in funnel on a gated prompt', async () => {
    const result = await shapePromptDetail(deps(viewerOf('anon')), GATED);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.prompt.locked).toBe(true);
    expect(result.unlockPanel).toEqual({ state: 'signin' });
  });

  it('offers a funded free reader the spend, with the real balance', async () => {
    const result = await shapePromptDetail(deps(viewerOf('free')), GATED);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.prompt.locked).toBe(true);
    expect(result.unlockPanel).toEqual({ state: 'spend', balance: 3 });
  });

  it('offers an empty free reader the wallet panel', async () => {
    await setWallet(FIXTURE_USERS.free.id, 0, '1 hour');
    const result = await shapePromptDetail(deps(viewerOf('free')), GATED);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.unlockPanel).toEqual({ state: 'empty' });
  });

  /**
   * Design review F5. A session whose profile row is gone reads a null wallet; folding that
   * into 'empty' claimed "you have 0 cookies" and pitched the $4 pack on a number nobody read.
   * The panel is its own state now — still no spend control, but no claim and no pitch.
   */
  it('answers wallet-unreadable with the unavailable panel, not the empty pitch', async () => {
    const ghost = { ...viewerOf('free'), userId: '00000000-0000-4000-8000-00000000dead' };
    const result = await shapePromptDetail(deps(ghost), GATED);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.prompt.locked).toBe(true);
    expect(result.unlockPanel).toEqual({ state: 'unavailable' });
  });

  it('reads the wallet as a WALLET READ: the weekly grant lands on the detail view (§15.1-3)', async () => {
    await setWallet(FIXTURE_USERS.free.id, 0, '8 days');
    const result = await shapePromptDetail(deps(viewerOf('free')), GATED);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // The grant fired inside the read that observed it, so the panel offers the spend.
    expect(result.unlockPanel).toEqual({ state: 'spend', balance: 1 });
  });

  it('shows no panel where nothing is for sale: pro, admin, teasers, community', async () => {
    for (const [tier, slug] of [
      ['pro', GATED],
      ['admin', GATED],
      ['anon', TEASER],
      ['free', COMMUNITY],
    ] as Array<[Tier, string]>) {
      const result = await shapePromptDetail(deps(viewerOf(tier)), slug);
      expect(result.status, `${tier} × ${slug}`).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.prompt.locked, `${tier} × ${slug}`).toBe(false);
      expect(result.unlockPanel, `${tier} × ${slug}`).toBeNull();
    }
  });

  it('never touches the wallet for an anonymous reader', async () => {
    const statements: string[] = [];
    const spy: SqlRunner = {
      query(text, params) {
        statements.push(text);
        return sql().query(text, params);
      },
      transaction: (fn) => sql().transaction(() => fn(spy)),
    };

    await shapePromptDetail({ sql: spy, viewer: viewerOf('anon') }, GATED);
    expect(statements.some((s) => s.includes('cookie_balance'))).toBe(false);
    expect(statements.some((s) => s.includes('for update'))).toBe(false);

    // Positive control: the same read for a signed-in viewer IS a wallet read.
    statements.length = 0;
    await shapePromptDetail({ sql: spy, viewer: viewerOf('free') }, GATED);
    expect(statements.some((s) => s.includes('cookie_balance'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // the unlock clause
  // -------------------------------------------------------------------------

  it('opens the text for a free reader who unlocked THIS prompt, and no other', async () => {
    const promptId = await idOf(GATED);
    expect(await unlockPrompt(sql(), FIXTURE_USERS.free.id, promptId)).toBe('unlocked');

    const unlocked = await shapePromptDetail(deps(viewerOf('free')), GATED);
    expect(unlocked.status).toBe('ok');
    if (unlocked.status !== 'ok') return;
    expect(unlocked.prompt.locked).toBe(false);
    expect(JSON.stringify(unlocked.prompt)).toContain(sentinelFor(GATED));
    expect(unlocked.unlockPanel).toBeNull();

    // The unlock is per (account, prompt): the second gated item stays locked…
    const other = await shapePromptDetail(deps(viewerOf('free')), GATED_2);
    expect(other.status).toBe('ok');
    if (other.status !== 'ok') return;
    expect(other.prompt.locked).toBe(true);
    expect(JSON.stringify(other.prompt)).not.toContain(sentinelFor(GATED_2));

    // …and per account: the pro fixture's absence of a row changes nothing for free #2.
    const stranger = await shapePromptDetail(
      deps({ ...viewerOf('free'), userId: FIXTURE_USERS.pro.id, tier: 'free' }),
      GATED,
    );
    expect(stranger.status).toBe('ok');
    if (stranger.status !== 'ok') return;
    expect(stranger.prompt.locked).toBe(true);
  });

  // -------------------------------------------------------------------------
  // the copy endpoint follows the same clause (§15.3)
  // -------------------------------------------------------------------------

  it('lets copy follow the unlock, and only the unlock', async () => {
    const promptId = await idOf(GATED);
    const otherId = await idOf(GATED_2);

    expect((await authorizePromptCopy(sql(), viewerOf('free'), promptId)).status).toBe('forbidden');

    await unlockPrompt(sql(), FIXTURE_USERS.free.id, promptId);

    const decision = await authorizePromptCopy(sql(), viewerOf('free'), promptId);
    expect(decision.status).toBe('ok');
    if (decision.status === 'ok') expect(decision.text).toContain(sentinelFor(GATED));

    // The neighbouring gated prompt is still 403 — an unlock is not a tier.
    expect((await authorizePromptCopy(sql(), viewerOf('free'), otherId)).status).toBe('forbidden');
    // And anon is still 401 — an unlock row cannot exist without an account.
    expect((await authorizePromptCopy(sql(), viewerOf('anon'), promptId)).status).toBe(
      'unauthorized',
    );
  });

  it('keeps the pro tier a valid unlock path — dormant, not dead (§15.1-4)', async () => {
    const promptId = await idOf(GATED);
    for (const tier of ['pro', 'admin'] as Tier[]) {
      const decision = await authorizePromptCopy(sql(), viewerOf(tier), promptId);
      expect(decision.status, tier).toBe('ok');
    }
  });
});
