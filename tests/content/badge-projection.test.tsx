import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { badgeFor } from '@/lib/content/badges';
import { loadCatalogRows } from '@/lib/content/catalog';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { PlaybookCard, type CardLabels } from '@/components/landing/playbook-card';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, freshDb, runner } from '../helpers/pglite';
import { createDraft } from '../helpers/factory';
import { preparePublish, publishRevision } from '@/lib/publish/pipeline';

/**
 * §3.5 badges, end to end: the two dates come out of the catalog projection (real SQL, real
 * publish RPCs), through `badgeFor`, into the card component.
 *
 * The unit truth table is `tests/content/badges.test.ts`; what this adds is that the projection
 * actually supplies the right two dates — in particular that `firstPublishedAt` is the playbook's
 * DEBUT and survives a republication, which is the one thing a single-revision fixture cannot show.
 */

const labels: CardLabels = (() => {
  const dict = getDictionary('en');
  return {
    steps: dict.library.steps,
    proBlocks: dict.library.proBlocks,
    open: dict.library.open,
    showcase: dict.featured.showcaseLabel,
    loginWall: dict.featured.loginWallLabel,
    badgeNew: dict.badge.new,
    badgeUpdated: dict.badge.updated,
  };
})();

describe('badge dates come from the catalog projection (§3.5)', () => {
  let db: PGlite;
  let storage: StorageDriver;
  let root: string;

  beforeEach(async () => {
    db = await freshDb();
    root = await mkdtemp(join(tmpdir(), 'playbook-badges-'));
    storage = createLocalStorageDriver(root);
  });

  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  async function publish(revisionId: string, playbookId: string) {
    await preparePublish(runner(db), revisionId);
    await publishRevision(runner(db), { playbookId, revisionId });
  }

  it('reports a first publication as NEW with no update date', async () => {
    const draft = await createDraft(db, storage, { slug: 'debut' });
    await publish(draft.revisionId, draft.playbookId);

    const [row] = await loadCatalogRows(runner(db));
    expect(row!.firstPublishedAt).toBe(row!.publishedAt);
    expect(row!.updatedAt).toBeNull();
    expect(badgeFor({ firstPublishedAt: row!.firstPublishedAt, updatedAt: row!.updatedAt })).toBe(
      'new',
    );
  });

  it('keeps the DEBUT date across a republication, and dates the rewrite separately', async () => {
    const rev1 = await createDraft(db, storage, { slug: 'rewritten' });
    await publish(rev1.revisionId, rev1.playbookId);
    const debut = (await loadCatalogRows(runner(db)))[0]!.publishedAt;

    // Age the first publication past the badge window. `published_at` is reserved to the publisher
    // role (§6 triggers — the guard is real, and this is the only legitimate way through it).
    await asRole(db, 'publisher', () =>
      db.query(
        `update playbook_revisions set published_at = now() - interval '90 days' where id = $1`,
        [rev1.revisionId],
      ),
    );

    const rev2 = await createDraft(db, storage, {
      slug: 'rewritten',
      playbookId: rev1.playbookId,
      revNo: 2,
      changeNote: { en: 'Swapped the model', ko: '모델 교체' },
    });
    await publish(rev2.revisionId, rev1.playbookId);

    const [row] = await loadCatalogRows(runner(db));
    expect(row!.firstPublishedAt).not.toBe(row!.publishedAt);
    expect(new Date(row!.firstPublishedAt!).getTime()).toBeLessThan(new Date(debut!).getTime());
    // The rewrite carries a change note, so it is what UPDATED is dated from.
    expect(row!.updatedAt).toBe(row!.publishedAt);
    expect(badgeFor({ firstPublishedAt: row!.firstPublishedAt, updatedAt: row!.updatedAt })).toBe(
      'updated',
    );
  });

  it('renders the chip on the card, bilingually, and nothing when neither window is open', async () => {
    const draft = await createDraft(db, storage, { slug: 'chip' });
    await publish(draft.revisionId, draft.playbookId);
    const [card] = await loadCatalogRows(runner(db));

    const fresh = renderToStaticMarkup(
      <PlaybookCard
        card={card!}
        index={1}
        locale="en"
        categoryLabel="Pipeline"
        difficultyLabel="Intermediate"
        labels={labels}
      />,
    );
    expect(fresh).toContain('data-badge="new"');
    expect(fresh).toContain('>NEW<');

    const ko = renderToStaticMarkup(
      <PlaybookCard
        card={card!}
        index={1}
        locale="ko"
        categoryLabel="파이프라인"
        difficultyLabel="중급"
        labels={{ ...labels, badgeNew: getDictionary('ko').badge.new }}
      />,
    );
    expect(ko).toContain('data-badge="new"');
    expect(ko).toContain('>신규<');

    // Same card, read a year later: no chip at all rather than a stale one.
    const later = renderToStaticMarkup(
      <PlaybookCard
        card={card!}
        index={1}
        locale="en"
        categoryLabel="Pipeline"
        difficultyLabel="Intermediate"
        labels={labels}
        now={Date.parse(card!.publishedAt!) + 400 * 24 * 60 * 60 * 1000}
      />,
    );
    expect(later).not.toContain('data-badge');
  });
});
