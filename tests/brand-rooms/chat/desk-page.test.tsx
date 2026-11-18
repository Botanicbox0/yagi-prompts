import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4 — the team's desk for one project, rendered from a real schema: the project,
 * its brand, status and waiting count; the project's conversation on the left; on the right the drafts with
 * every version's brand and team counts (the chosen version's stage in place, kept in the address), the
 * storyboards leading to their own pages, and the share links with the team's create and turn-off. Another
 * brand's project, a closed brand, an unknown project and the flag off are all a 404.
 */
const db = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko', getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => db.viewer, getViewer: async () => db.viewer }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/brand-rooms',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import DeskPage from '@/app/(admin)/admin/brand-rooms/[organizationId]/[projectId]/page';
import { runRoomOperation, staffAcknowledge } from '@/lib/brand-rooms/messages';
import { createShare } from '@/lib/brand-rooms/shares';
import { staffCreateStoryboard, staffReplaceFrames, staffShareStoryboard } from '@/lib/brand-rooms/storyboards';
import { staffAddComment } from '@/lib/brand-studio/review';
import type { ReviewCreated } from '@/lib/brand-studio/review-contracts';
import { pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, roomDraft, seedProject, teamDelivery } from '../review/fixtures';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

/** The href of the first link whose opening tag carries `marker` (attribute order is the renderer's). */
const hrefOf = (page: string, marker: string): string | null => {
  // Markers here are plain `name="value"` pairs: nothing in them needs escaping for a RegExp.
  const tag = page.match(new RegExp(`<a [^>]*${marker}[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1] ?? null;
};

/** The desk header's 확인함 form. */
const ackForm = (page: string): string => {
  const start = page.indexOf('<form class="brc-desk-ack"');
  return start < 0 ? '' : page.slice(start, page.indexOf('</form>', start));
};

const open = (organizationId: string, projectId: string, search: Record<string, string> = {}) =>
  DeskPage({ params: Promise.resolve({ organizationId, projectId }), searchParams: Promise.resolve(search) });

let f: StudioFixture;
let v1 = '';
let v2 = '';
let elsewhere = '';
let boardId = '';
let otherOrg = '';
let otherProject = '';
beforeAll(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  db.sql = f.sql;
  db.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
  const deps = studioDeps(f.sql);
  v1 = ((await teamDelivery(f, deps)) as { created: ReviewCreated }).created.review.id;
  v2 = ((await teamDelivery(f, deps, { stackReviewId: v1, colour: 150 })) as { created: ReviewCreated }).created.review.id;
  await staffAddComment(reviewDeps(deps), db.viewer, { reviewId: v2, body: 'Check the grade', visibility: 'team' });
  await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: v2, passphrase: 'pass-word' });
  const board = await staffCreateStoryboard(deps, db.viewer, { projectId: f.projectId, title: 'Launch film' });
  boardId = (board as { board: { id: string } }).board.id;
  await staffReplaceFrames(deps, db.viewer, { storyboardId: boardId, frames: [{ picture: await pngBytes(30, 40), text: { scene: '1', shot: '1', description: 'Open' } }] });
  await staffShareStoryboard(deps, db.viewer, { storyboardId: boardId });
  // A brand line after the team's last move: one waiting.
  await runRoomOperation({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), 'message.send', { organizationId: f.orgId, projectId: f.projectId, requestId: randomUUID(), body: '두 번째 버전 좋아요' });
  // A draft of another project of the same brand, and a project of another brand.
  const second = await seedProject(f);
  elsewhere = await roomDraft(f, deps, 'image', 'Other still').then(async (id) => {
    await f.sql.query('update brand_studio_reviews set project_id = $2 where id = $1', [id, second]);
    return id;
  });
  otherOrg = (await f.sql.query<{ id: string }>(`insert into brand_organizations (id, name, created_by, request_id) values (gen_random_uuid(), 'Other brand', $1, gen_random_uuid()) returning id`, [f.ids.owner])).rows[0]!.id;
  otherProject = await seedProject(f, otherOrg, 'Their film');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('/admin/brand-rooms/[organizationId]/[projectId]', () => {
  it('shows the project, its brand, status and waiting count, the conversation and the drafts with both counts', async () => {
    const page = await html(open(f.orgId, f.projectId));
    expect(page).toContain(`data-admin-room-desk="${f.projectId}"`);
    expect(page).toContain('Spring launch');
    expect(page).toContain('Studio fixture brand');
    expect(page).toContain('aria-label="1개 기다림"');
    expect(page).toContain(`data-room-channel="${f.projectId}"`);
    expect(page).toContain('data-admin-desk-conversation');
    expect(page).toContain(`href="/admin/brand-rooms/${f.orgId}?channel=general"`);
    for (const tab of ['drafts', 'storyboards', 'links']) expect(page).toContain(`data-filter="${tab}"`);
    expect(page).toContain('data-admin-desk-tab="drafts"');
    expect(page).toContain(`data-admin-desk-version="${v1}"`);
    expect(page).toContain(`data-admin-desk-version="${v2}"`);
    expect(page).toContain(`href="/admin/brand-rooms/${f.orgId}/${f.projectId}?review=${v2}"`);
    // v2: no brand notes; one open team note of one, counted apart. v1: neither.
    const row = (id: string) => {
      const start = page.indexOf(`data-admin-desk-version="${id}"`);
      return page.slice(start, page.indexOf('</tr>', start));
    };
    // (The first match is the version column, "v2 / 2".)
    expect(row(v2).match(/\d+ \/ \d+/g)).toEqual(['2 / 2', '0 / 0', '1 / 1']);
    expect(row(v1).match(/\d+ \/ \d+/g)?.slice(-2)).toEqual(['0 / 0', '0 / 0']);
    expect(page).toContain('data-admin-delivery-form');
    expect(page).not.toContain(`data-admin-desk-version="${elsewhere}"`);
    expect(page).not.toContain('data-admin-desk-stage');
    // List mode: the conversation is the column; no drawer button.
    expect(page).toContain('data-admin-desk-mode="list"');
    expect(page).toContain('data-desk-mode="list"');
    expect(page).not.toContain('data-admin-desk-chat-toggle');
    // 확인함 in the header, enabled while something waits, posting the registered operation back to this page.
    const ack = ackForm(page);
    expect(ack).toContain('value="brand_rooms.channel.ack"');
    expect(ack).toContain(`name="_back" value="/admin/brand-rooms/${f.orgId}/${f.projectId}"`);
    expect(ack).toContain(`name="projectId" value="${f.projectId}"`);
    expect(ack).toMatch(/<button type="submit" class="admin-btn" title="숫자는 아직 답하지 않은 고객 메시지예요\.[^"]*" data-admin-desk-ack-button="true">확인함<\/button>/);
    expect(ack).not.toContain('data-admin-desk-ack-by');
  });

  it('opens the chosen version full width in the review frame, the conversation as a drawer, and keeps the version in the address', async () => {
    const page = await html(open(f.orgId, f.projectId, { review: v2, t: '1500' }));
    expect(page).toContain('data-admin-desk-mode="review"');
    expect(page).toContain('data-desk-mode="review"');
    expect(page).toContain(`data-admin-desk-stage="${v2}"`);
    // The same frame the standalone review page uses (review.css `.bsv-admin-frame`).
    expect(page).toMatch(/class="bsv-admin-frame" data-admin-review-frame="true"><section class="bsv-stage"/);
    expect(page).toContain('팀만 보기');
    expect(page).toContain('Check the grade');
    // The desk names the draft; the stage keeps its title for assistive technology only, and the version
    // switcher (which names each status) replaces the separate status mark.
    expect(page).toContain('data-review-heading="hidden"');
    expect(page).not.toContain('class="bsv-eyebrow"');
    expect(page).toContain('data-review-versions');
    expect(page).not.toContain('class="bsv-status"');
    expect(hrefOf(page, 'data-admin-desk-close="true"')).toBe(`/admin/brand-rooms/${f.orgId}/${f.projectId}`);
    // The version list gives way to the stage.
    expect(page).not.toContain('data-admin-desk-version=');
    // The conversation is still on the page, in the same container, as a closed drawer with its own close
    // button; the header's "대화" button carries the waiting count (and the title no longer does).
    expect(page).toMatch(/<aside id="brc-desk-chat" class="brc-desk-chat"[^>]*data-open="false"/);
    expect(page).toContain(`data-room-channel="${f.projectId}"`);
    expect(page).toContain('data-admin-desk-chat-close');
    expect(page).toMatch(/aria-expanded="false" aria-controls="brc-desk-chat" data-admin-desk-chat-toggle="true">대화<span class="admin-count-chip" aria-label="1개 기다림">1<\/span>/);
    expect(page.match(/aria-label="1개 기다림"/g)).toHaveLength(1);
    // 확인함 is reachable in review mode too, keeping the chosen version in its way back.
    expect(ackForm(page)).toContain(`name="_back" value="/admin/brand-rooms/${f.orgId}/${f.projectId}?review=${v2}"`);
    expect(ackForm(page)).not.toMatch(/disabled=""/);
    // A version of another project is not opened here.
    const other = await html(open(f.orgId, f.projectId, { review: elsewhere }));
    expect(other).not.toContain('data-admin-desk-stage');
    expect(other).toContain('data-admin-desk-mode="list"');
  });

  it('moves between tabs with client-side links that keep the chosen version, and keeps the conversation in one container', async () => {
    const list = await html(open(f.orgId, f.projectId));
    const reviewing = await html(open(f.orgId, f.projectId, { review: v2 }));
    const boards = await html(open(f.orgId, f.projectId, { tab: 'storyboards', review: v2 }));
    // The same container holds the conversation in every state (RoomDeskFrame never moves it).
    for (const page of [list, reviewing, boards]) expect(page).toMatch(/<aside id="brc-desk-chat"[\s\S]*data-room-channel=/);
    // Away from 시안 the version stays in every tab's address, so 시안 (or a reload) reopens it.
    expect(boards).toContain('data-admin-desk-mode="list"');
    expect(hrefOf(boards, 'data-filter="drafts"')).toBe(`/admin/brand-rooms/${f.orgId}/${f.projectId}?review=${v2}`);
    expect(hrefOf(boards, 'data-filter="links"')).toBe(`/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=links&amp;review=${v2}`);
    expect(hrefOf(reviewing, 'data-filter="storyboards"')).toBe(`/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=storyboards&amp;review=${v2}`);
    // With no version chosen the tabs carry none.
    expect(hrefOf(list, 'data-filter="storyboards"')).toBe(`/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=storyboards`);
  });

  it('lists the storyboards, each leading to its own page', async () => {
    const page = await html(open(f.orgId, f.projectId, { tab: 'storyboards' }));
    expect(page).toContain('data-admin-desk-tab="storyboards"');
    expect(page).toContain(`data-admin-desk-storyboard="${boardId}"`);
    expect(page).toContain(`href="/admin/brand-rooms/storyboards/${boardId}"`);
    expect(page).toContain('Launch film');
  });

  it('lists the share links with a turn-off that returns to this tab, and the team create form', async () => {
    const page = await html(open(f.orgId, f.projectId, { tab: 'links' }));
    expect(page).toContain('data-admin-desk-tab="links"');
    expect(page).toContain('data-admin-desk-share=');
    expect(page).toContain('data-admin-desk-share-state="live"');
    expect(page).toContain('value="brand_rooms.share.revoke"');
    expect(page).toContain(`name="_back" value="/admin/brand-rooms/${f.orgId}/${f.projectId}?tab=links"`);
    expect(page).toContain(`name="projectId" value="${f.projectId}"`);
    expect(page).toContain('data-admin-desk-share-revoke=');
    expect(page).toContain('data-admin-share-create');
    expect(page).toContain('value="brand_rooms.share.create"');
    expect(page).toContain(`value="review:${v2}"`);
    expect(page).toContain(`value="storyboard:${boardId}"`);
  });

  it('is a 404 for another brand project, a closed brand, an unknown project, a hidden project and the flag off', async () => {
    expect(await html(open(otherOrg, otherProject))).toContain(`data-admin-room-desk="${otherProject}"`);
    await expect(open(f.orgId, otherProject)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(open(f.orgId, randomUUID())).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(open('not-a-uuid', f.projectId)).rejects.toThrow('NEXT_NOT_FOUND');
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    await expect(open(f.orgId, f.projectId)).rejects.toThrow('NEXT_NOT_FOUND');
    await f.sql.query('update brand_projects set client_visible = true where id = $1', [f.projectId]);
    await f.sql.query("update brand_organizations set name = 'Morphic Korea' where id = $1", [otherOrg]);
    await expect(open(otherOrg, otherProject)).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('BRAND_ROOMS', 'off');
    await expect(open(f.orgId, f.projectId)).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('BRAND_ROOMS', 'on');
  });

  // Last: it changes what waits for the other cases.
  it('after 확인함: no count, the button off until the next customer line, and who pressed it', async () => {
    expect(await staffAcknowledge({ sql: f.sql }, db.viewer!, { organizationId: f.orgId, projectId: f.projectId })).toMatchObject({ ok: true });
    const page = await html(open(f.orgId, f.projectId));
    expect(page).not.toContain('aria-label="1개 기다림"');
    expect(ackForm(page)).toMatch(/<button type="submit" class="admin-btn" disabled="" title="[^"]*" data-admin-desk-ack-button="true">확인함<\/button>/);
    expect(ackForm(page)).toMatch(/<span class="brc-desk-ack-by" data-admin-desk-ack-by="true">admin · [^<]+<\/span>/);
  });
});
