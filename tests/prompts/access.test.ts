import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { Tier } from '@/lib/content/visibility';
import { authorizePromptCopy, shapePromptDetail } from '@/lib/prompts/access';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { HIDDEN_PROMPT_SLUGS, PROMPT_SENTINELS } from '../../scripts/prompt-fixtures';
import { viewerOf } from '../helpers/admin';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §13.2 / §13.3-5 — the gate, driven against real fixtures.
 *
 * Two independent questions, and keeping them apart is the whole design:
 *   · **does this page exist** — a status question, identical for every tier including admin;
 *   · **does this reader get the text** — a tier question, and never an error.
 */

const TIERS: Tier[] = ['anon', 'free', 'pro', 'admin'];
const sentinelFor = (slug: string) => PROMPT_SENTINELS.find((s) => s.slug === slug)!.token;

describe('prompt detail gate (§13.2)', () => {
  let harness: PromptHarness;
  const deps = (viewer: Viewer) => ({ sql: harness.sql, viewer });

  beforeAll(async () => {
    harness = await promptHarness();
  });
  afterAll(async () => harness.close());

  it('404s pending, rejected and unknown slugs — for EVERY tier, admin included', async () => {
    for (const slug of [...HIDDEN_PROMPT_SLUGS, 'no-such-prompt']) {
      for (const tier of TIERS) {
        const result = await shapePromptDetail(deps(viewerOf(tier)), slug);
        expect(result.status, `${slug} × ${tier}`).toBe('not_found');
      }
    }
  });

  it('404s an archived prompt (the bytes stay disclosed; the page stops)', async () => {
    const live = (await loadPromptBySlug(harness.sql, 'neon-alley-dolly'))!;
    await harness.sql.query(`update prompt_items set status = 'archived' where id = $1`, [live.id]);
    expect((await shapePromptDetail(deps(viewerOf('admin')), 'neon-alley-dolly')).status).toBe(
      'not_found',
    );
    await harness.sql.query(`update prompt_items set status = 'published' where id = $1`, [live.id]);
  });

  it('renders a pro item for everyone and hands the text to nobody below pro', async () => {
    const token = sentinelFor('neon-alley-dolly');
    for (const tier of TIERS) {
      const result = await shapePromptDetail(deps(viewerOf(tier)), 'neon-alley-dolly');
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      const entitled = tier === 'pro' || tier === 'admin';
      expect(result.prompt.locked, tier).toBe(!entitled);
      expect(JSON.stringify(result.prompt).includes(token), tier).toBe(entitled);
      // Even locked, the card surface is there — that is the §5.5 doctrine, not an error state.
      expect(result.prompt.title).toBe('Neon alley dolly');
      expect(result.prompt.poster).not.toBeNull();
    }
  });

  it('hands a public teaser and a community prompt to an anonymous reader', async () => {
    for (const slug of ['static-portrait-window-light', 'skate-park-golden-hour']) {
      const result = await shapePromptDetail(deps(viewerOf('anon')), slug);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.prompt.locked).toBe(false);
      expect(JSON.stringify(result.prompt)).toContain(sentinelFor(slug));
    }
  });

  it('never emits a staging key on the detail payload, at any tier', async () => {
    for (const tier of TIERS) {
      const result = await shapePromptDetail(deps(viewerOf(tier)), 'neon-alley-dolly');
      expect(JSON.stringify(result)).not.toContain('content/prompt/');
    }
  });

  it('attaches four related cards, and they carry no text either', async () => {
    const result = await shapePromptDetail(deps(viewerOf('pro')), 'neon-alley-dolly');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.related).toHaveLength(4);
    const serialised = JSON.stringify(result.related);
    for (const sentinel of PROMPT_SENTINELS) {
      expect(serialised.includes(sentinel.token), sentinel.token).toBe(false);
    }
  });
});

describe('copy endpoint authorization (§13.3-5)', () => {
  let harness: PromptHarness;

  beforeAll(async () => {
    harness = await promptHarness();
  });
  afterAll(async () => harness.close());

  const idOf = async (slug: string) => (await loadPromptBySlug(harness.sql, slug))!.id;

  it('gives a community prompt to anyone, signed in or not', async () => {
    const id = await idOf('skate-park-golden-hour');
    for (const tier of TIERS) {
      const decision = await authorizePromptCopy(harness.sql, viewerOf(tier), id);
      expect(decision.status, tier).toBe('ok');
      if (decision.status === 'ok') {
        expect(decision.text).toContain(sentinelFor('skate-park-golden-hour'));
      }
    }
  });

  it('splits refusals: 401 for anon, 403 for a signed-in free reader', async () => {
    const id = await idOf('neon-alley-dolly');
    expect((await authorizePromptCopy(harness.sql, viewerOf('anon'), id)).status).toBe('unauthorized');
    expect((await authorizePromptCopy(harness.sql, viewerOf('free'), id)).status).toBe('forbidden');
    expect((await authorizePromptCopy(harness.sql, viewerOf('pro'), id)).status).toBe('ok');
    expect((await authorizePromptCopy(harness.sql, viewerOf('admin'), id)).status).toBe('ok');
  });

  it('never puts the text in a refusal', async () => {
    const id = await idOf('neon-alley-dolly');
    for (const tier of ['anon', 'free'] as Tier[]) {
      const decision = await authorizePromptCopy(harness.sql, viewerOf(tier), id);
      expect(JSON.stringify(decision)).not.toContain(sentinelFor('neon-alley-dolly'));
    }
  });

  it('404s a pending, a rejected and an unknown id — before any tier is considered', async () => {
    const pending = await idOf('pending-underwater-drift');
    const rejected = await idOf('rejected-stock-lookalike');
    for (const id of [pending, rejected, '11111111-2222-4333-8444-555555555555']) {
      for (const tier of TIERS) {
        expect((await authorizePromptCopy(harness.sql, viewerOf(tier), id)).status).toBe('not_found');
      }
    }
  });

  it('answers not_found rather than throwing on a malformed id', async () => {
    expect((await authorizePromptCopy(harness.sql, viewerOf('pro'), 'not-a-uuid')).status).toBe(
      'not_found',
    );
  });
});
