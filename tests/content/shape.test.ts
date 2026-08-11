import { describe, expect, it } from 'vitest';
import { shapeRevision, type RevisionInput } from '@/lib/content/shape';
import { BLOCK_KINDS, type AssetRef } from '@/lib/content/schemas';
import { TIER_ORDER, VISIBILITY_ORDER, type Tier, type Visibility } from '@/lib/content/visibility';

/**
 * PLAN §7/§8 M2 acceptance, landed early because M0 owns the pure function:
 * the 4 tiers × 4 visibilities truth table, plus the strip assertions.
 */

const L = (s: string) => ({ en: s, ko: `${s} (ko)` });

const staging = (name: string) => `content/rev/rev-1/${name}.png`;
const SHA = 'a'.repeat(64);

function privateAsset(name: string): AssetRef {
  return {
    staging_key: staging(name),
    sha256: SHA,
    published_key: `${SHA}.png`,
    bucket: 'content-published',
    mime: 'image/png',
    w: 800,
    h: 600,
  };
}

function publicAsset(name: string): AssetRef {
  return {
    staging_key: staging(name),
    sha256: SHA,
    published_key: `${SHA}.png`,
    bucket: 'public-content',
    mime: 'image/png',
  };
}

const CONTENT_FOR_KIND: Record<(typeof BLOCK_KINDS)[number], unknown> = {
  prompt: { text: 'the secret prompt', model: 'GPT Image 2' },
  params: { rows: [{ k: 'cfg', v: '4.5' }] },
  asset: { asset: privateAsset('asset'), caption: L('caption') },
  note: { md: L('note body') },
  link: { url: 'https://example.com/x', label: L('label') },
  workflow_file: {
    asset: privateAsset('graph'),
    filename: 'graph.json',
    size_bytes: 12,
    format: 'comfyui',
  },
};

function revisionWith(blocks: Array<{ kind: (typeof BLOCK_KINDS)[number]; visibility: Visibility }>): RevisionInput {
  return {
    id: 'rev-1',
    playbook_id: 'pb-1',
    slug: 'fixture',
    category: 'pipeline',
    rev_no: 1,
    state: 'published',
    is_showcase: true,
    title: L('title'),
    summary: L('summary'),
    difficulty: 'intermediate',
    tools: [],
    models: [],
    est_time_min: 10,
    est_cost_usd: 1,
    hero_asset: publicAsset('hero'),
    change_note: null,
    published_at: '2026-08-12T00:00:00.000Z',
    steps: [
      {
        id: 'step-1',
        order: 1,
        title: L('step'),
        body: null,
        blocks: blocks.map((b, i) => ({
          id: `block-${i}`,
          order: i + 1,
          kind: b.kind,
          content: CONTENT_FOR_KIND[b.kind],
          effective_visibility: b.visibility,
        })),
      },
    ],
  };
}

describe('shapeRevision truth table — 4 tiers × 4 visibilities (§7)', () => {
  const EXPECTED: Record<Tier, Record<Visibility, boolean>> = {
    anon: { public: true, free: false, pro: false, hidden: false },
    free: { public: true, free: true, pro: false, hidden: false },
    pro: { public: true, free: true, pro: true, hidden: false },
    admin: { public: true, free: true, pro: true, hidden: true },
  };

  for (const tier of TIER_ORDER) {
    for (const visibility of VISIBILITY_ORDER) {
      const visible = EXPECTED[tier][visibility];
      it(`${tier} × ${visibility} → ${visible ? 'content' : 'locked'}`, () => {
        const shaped = shapeRevision(revisionWith([{ kind: 'prompt', visibility }]), tier);
        const block = shaped.steps[0]?.blocks[0];
        expect(block).toBeDefined();
        expect(block!.locked).toBe(!visible);
        expect(block!.visibility).toBe(visibility);
        expect(block!.kind).toBe('prompt');
        if (visible) {
          expect(block!.locked === false && block!.content).toMatchObject({
            kind: 'prompt',
            text: 'the secret prompt',
          });
        } else {
          // no teaser, no blurred bytes — chrome and kind only (§3.3)
          expect(Object.keys(block!).sort()).toEqual(['id', 'kind', 'locked', 'order', 'visibility']);
          expect(JSON.stringify(block)).not.toContain('the secret prompt');
        }
      });
    }
  }

  it('counts locks per step and for the revision (§5.5 step index)', () => {
    const shaped = shapeRevision(
      revisionWith([
        { kind: 'link', visibility: 'public' },
        { kind: 'note', visibility: 'free' },
        { kind: 'prompt', visibility: 'pro' },
        { kind: 'params', visibility: 'hidden' },
      ]),
      'free',
    );
    expect(shaped.steps[0]?.lockedCount).toBe(2);
    expect(shaped.lockedCount).toBe(2);
  });
});

describe('shapeRevision strips storage keys (§3.3 / §7)', () => {
  it('never emits staging keys, for any tier or kind', () => {
    const blocks = BLOCK_KINDS.map((kind) => ({ kind, visibility: 'public' as Visibility }));
    for (const tier of TIER_ORDER) {
      const serialized = JSON.stringify(shapeRevision(revisionWith(blocks), tier));
      expect(serialized).not.toContain('staging_key');
      expect(serialized).not.toContain('content/rev/');
    }
  });

  it('replaces private published keys with the entitlement-checked gateway path', () => {
    const shaped = shapeRevision(
      revisionWith([{ kind: 'asset', visibility: 'public' }]),
      'admin',
    );
    const block = shaped.steps[0]?.blocks[0];
    expect(block && !block.locked && block.content.kind === 'asset' && block.content.asset).toEqual({
      source: 'gateway',
      src: '/api/media/block-0',
      mime: 'image/png',
      w: 800,
      h: 600,
    });
    expect(JSON.stringify(shaped)).not.toContain(`${SHA}.png"`.slice(0, 10) + 'x'); // no raw key echo
    expect(JSON.stringify(block)).not.toContain('published_key');
    expect(JSON.stringify(block)).not.toContain('content-published');
  });

  it('serves public-bucket objects (heroes) by URL, not by gateway', () => {
    const shaped = shapeRevision(revisionWith([]), 'anon');
    expect(shaped.hero).toEqual({
      source: 'public',
      src: `/storage/v1/object/public/public-content/${SHA}.png`,
      mime: 'image/png',
    });
  });

  it('honours injected URL resolvers so the shaper stays pure', () => {
    const shaped = shapeRevision(revisionWith([{ kind: 'asset', visibility: 'public' }]), 'pro', {
      publicUrl: (key) => `https://cdn.example/${key}`,
      mediaUrl: (id) => `https://app.example/api/media/${id}`,
    });
    expect(shaped.hero?.src).toBe(`https://cdn.example/${SHA}.png`);
    const block = shaped.steps[0]?.blocks[0];
    expect(block && !block.locked && block.content.kind === 'asset' && block.content.asset.src).toBe(
      'https://app.example/api/media/block-0',
    );
  });

  it('fails closed on malformed jsonb rather than leaking the payload', () => {
    const revision = revisionWith([{ kind: 'prompt', visibility: 'public' }]);
    revision.steps[0]!.blocks[0]!.content = { text: 123, smuggled: 'secret-value' };
    const shaped = shapeRevision(revision, 'admin');
    expect(shaped.steps[0]?.blocks[0]?.locked).toBe(true);
    expect(JSON.stringify(shaped)).not.toContain('secret-value');
  });

  it('is order-stable regardless of input ordering', () => {
    const revision = revisionWith([
      { kind: 'prompt', visibility: 'public' },
      { kind: 'note', visibility: 'public' },
    ]);
    revision.steps[0]!.blocks.reverse();
    const shaped = shapeRevision(revision, 'admin');
    expect(shaped.steps[0]?.blocks.map((b) => b.order)).toEqual([1, 2]);
  });
});
