import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-CLIENT-WORK.md §4 B — a client who only commissions video (self-serve studio closed) submits a
 * request and lands in its room. Rendered from the real room page on PGlite with every migration.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: true, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});

const roomPage = (await import('@/app/(brand)/brand/rooms/[projectId]/page')).default;
const { getDictionary } = await import('@/lib/i18n/dictionaries');
const ko = getDictionary('ko');

let f: StudioFixture | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});
beforeEach(() => {
  vi.stubEnv('BRAND_ROOMS', 'on');
});

async function projectOnlyRoom(options: { mode: 'studio' | 'creator'; status: 'requested' | 'active' | 'completed' }) {
  f = await studioFixture({ orgName: 'Commission client', capKrw: 1_000_000 });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio'])`, [f.orgId]);
  await f.sql.query('update brand_projects set production_mode = $2, status = $3, title = $4 where id = $1', [f.projectId, options.mode, options.status, '봄 신제품 영상']);
  return f;
}
const render = async (fx: StudioFixture, query: Record<string, string> = {}) =>
  renderToStaticMarkup(
    (await roomPage({ params: Promise.resolve({ projectId: fx.projectId }), searchParams: Promise.resolve({ organizationId: fx.orgId, ...query }) })) as ReactElement,
  );

describe('a submitted video commission, in its room', () => {
  it('opens on one calm "we got it" note with a way back to the brief, and no numbered steps', async () => {
    const fx = await projectOnlyRoom({ mode: 'studio', status: 'requested' });
    const html = await render(fx);
    expect(html).toContain('data-room-received');
    expect(html).toContain(ko.roomsShell.overview.received.title);
    expect(html).toContain(ko.roomsShell.overview.received.line);
    expect(html).toContain(`tab=files&amp;category=brief" data-room-received-brief`);
    // The explanation with "이렇게 진행돼요 1–4" is gone; the stage line stays.
    expect(html).not.toContain('data-explainer-steps');
    expect(html).not.toContain('이렇게 진행돼요');
    expect(html).toContain('data-room-stages');
    // The first recent-activity line is the request itself.
    expect(html).toContain('data-room-activity-item="requested"');
    expect(html).toContain(ko.roomsShell.overview.activity.requested);
    expect(html).not.toContain(ko.roomsShell.overview.activityEmpty);
  });

  it('starts the conversation tab with the request line', async () => {
    const fx = await projectOnlyRoom({ mode: 'studio', status: 'requested' });
    const html = await render(fx, { tab: 'chat' });
    expect(html).toContain('data-room-requested');
    expect(html).toContain(ko.roomsShell.overview.activity.requested);
    expect(html).toContain('봄 신제품 영상');
  });

  it('opens 파일 on 기획서 from "낸 내용 보기"', async () => {
    const fx = await projectOnlyRoom({ mode: 'studio', status: 'requested' });
    const html = await render(fx, { tab: 'files', category: 'brief' });
    expect(html).toContain('data-room-files-category="brief"');
    expect(html).not.toContain('data-room-files-storyboard');
  });

  it('links to the campaign page only for a creator campaign', async () => {
    const film = await projectOnlyRoom({ mode: 'studio', status: 'requested' });
    expect(await render(film)).not.toContain('data-room-detail');
    await film.db.close();
    f = null;
    const campaign = await projectOnlyRoom({ mode: 'creator', status: 'requested' });
    expect(await render(campaign)).toContain('data-room-detail');
  });

  it('shows the 90-day note in a room only once the project is completed', async () => {
    const open = await projectOnlyRoom({ mode: 'studio', status: 'active' });
    for (const tab of ['overview', 'files', 'chat']) expect(await render(open, { tab })).not.toContain('data-project-only-retention-notice');
    await open.db.close();
    f = null;
    const done = await projectOnlyRoom({ mode: 'studio', status: 'completed' });
    const html = await render(done);
    expect(html).toContain('data-project-only-retention-notice');
    expect(html).toContain('data-project-only-archived="false"');
    expect(html).toContain(ko.roomsShell.space.retentionNotice);
    // Completed: no "we got it" note.
    expect(html).not.toContain('data-room-received');
  });
});
