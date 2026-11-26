import { randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  as,
  closeWorld,
  imageResult,
  membersLine,
  openSend,
  sendWorld,
  staffViewer,
  type SendWorld,
} from '../../brand-rooms/send/helpers';

const stub = vi.hoisted(() => ({
  locale: 'ko' as 'ko' | 'en',
  viewer: { userId: '', isAdmin: false } as Viewer,
  verifiedEmail: undefined as string | undefined,
  sql: null as SqlRunner | null,
  media: null as StudioMediaStore | null,
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth/viewer', () => ({
  getViewer: vi.fn(async () => stub.viewer),
}));

vi.mock('@/lib/auth/verified-email', () => ({
  getVerifiedEmail: vi.fn(async () => stub.verifiedEmail),
}));

vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: vi.fn(async () => stub.sql),
}));

vi.mock('@/lib/i18n/server', () => ({
  getRequestLocale: vi.fn(async () => stub.locale),
}));

vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: vi.fn(async () => ({ brand: true, origin: 'https://brand.twings.app' })),
}));

vi.mock('@/lib/brand-studio/media-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/media-store')>('@/lib/brand-studio/media-store');
  return {
    ...actual,
    createStudioMediaStore: vi.fn(() => {
      if (!stub.media) throw new Error('missing stub.media');
      return stub.media;
    }),
  };
});

import BrandInboxPage, { generateMetadata } from '@/app/(brand)/brand/inbox/page';

async function renderPage(searchParams: Record<string, string | string[] | undefined>): Promise<string> {
  const element = (await BrandInboxPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

describe('/brand/inbox server page', () => {
  let w: SendWorld;
  let rootId: string;

  beforeEach(async () => {
    w = await sendWorld();
    stub.locale = 'ko';
    stub.sql = w.f.sql;
    stub.media = w.deps.media;
    stub.verifiedEmail = undefined;
    stub.viewer = as(w.f.ids.owner);
    openSend(w.f.orgId);

    const file = (await imageResult(w, w.f.projectId)).outputId;
    rootId = await membersLine(w.f.sql, {
      organizationId: w.f.orgId,
      projectId: w.f.projectId,
      authorId: w.f.ids.editor,
      body: '리드 컷 확인 부탁드려요',
      file: { kind: 'output', id: file },
      mentions: [w.f.ids.owner],
    });
  });

  afterEach(async () => {
    await closeWorld(w);
  });

  it('opens for owner, editor, and viewer; loads ?thread= without marking it read during SSR; handles ?view=mentions and metadata', async () => {
    for (const [role, userId] of [
      ['owner', w.f.ids.owner],
      ['editor', w.f.ids.editor],
      ['viewer', w.f.ids.viewer],
    ] as const) {
      stub.viewer = as(userId);
      const html = await renderPage({ organizationId: w.f.orgId });
      expect(html, role).toContain('알림함');
      expect(html, role).toContain(role === 'viewer' ? '받은 메시지가 없어요.' : '리드 컷 확인 부탁드려요');
      expect(html, role).toContain('왼쪽에서 대화를 골라 주세요.');
    }

    stub.viewer = as(w.f.ids.owner);
    const meta = await generateMetadata({ searchParams: Promise.resolve({ organizationId: w.f.orgId }) });
    expect(meta.title).toBe('알림함');

    const withThreadHtml = await renderPage({ organizationId: w.f.orgId, thread: rootId });
    expect(withThreadHtml).toContain('리드 컷 확인 부탁드려요');
    expect(withThreadHtml).toContain('답글 남기기');
    expect(withThreadHtml).not.toContain('왼쪽에서 대화를 골라 주세요.');

    const readRows = await w.f.sql.query<{ user_id: string }>(
      'select user_id::text as user_id from brand_room_thread_reads where root_message_id = $1',
      [rootId],
    );
    expect(readRows.rows.some((r) => r.user_id.toLowerCase() === w.f.ids.owner.toLowerCase())).toBe(false);

    const mentionsHtml = await renderPage({ organizationId: w.f.orgId, view: 'mentions' });
    expect(mentionsHtml).toContain('data-send-view="mentions" aria-pressed="true"');

    const goneThreadHtml = await renderPage({ organizationId: w.f.orgId, thread: randomUUID() });
    expect(goneThreadHtml).toContain('이 대화를 더 볼 수 없어요.');

    // English title & heading must use "Inbox", not "Activity" (Fix 6)
    stub.locale = 'en';
    const enMeta = await generateMetadata({ searchParams: Promise.resolve({ organizationId: w.f.orgId }) });
    expect(enMeta.title).toBe('Inbox');
    const enHtml = await renderPage({ organizationId: w.f.orgId });
    expect(enHtml).toContain('>Inbox<');
    expect(enHtml).toContain('aria-label="Inbox"');
  });

  it('returns 404 (notFound) when any env gate, spine gate, or migration 0200 is closed', async () => {
    const cases: Array<[string, () => Promise<void> | void]> = [
      ['BRAND_SEND off', () => void vi.stubEnv('BRAND_SEND', 'off')],
      ['BRAND_ROOMS off', () => void vi.stubEnv('BRAND_ROOMS', 'off')],
      ['BRAND_ROOM_NOTIFY off', () => void vi.stubEnv('BRAND_ROOM_NOTIFY', 'off')],
      ['BRAND_STUDIO_V2 off', () => void vi.stubEnv('BRAND_STUDIO_V2', 'off')],
      ['BRAND_PROJECT_SPINE off', () => void vi.stubEnv('BRAND_PROJECT_SPINE', 'off')],
      ['org not on spine list', () => void vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID())],
      [
        '0200 dropped',
        async () => {
          await w.f.sql.query('drop table brand_room_thread_reads');
          resetBrandSendProbe();
        },
      ],
    ];

    for (const [label, close] of cases) {
      openSend(w.f.orgId);
      await close();
      await expect(renderPage({ organizationId: w.f.orgId }), label).rejects.toThrow('NEXT_NOT_FOUND');
      const meta = await generateMetadata({ searchParams: Promise.resolve({ organizationId: w.f.orgId }) });
      expect(meta, label).toEqual({});
    }
  });

  it('returns 404 (notFound) for closed organizations and disallowed seats (sandboxed, denied, project_only, guest, staff, outsider)', async () => {
    // Disallowed seats on open org
    for (const [label, viewer, email] of [
      ['guest', as(w.f.ids.guest), undefined],
      ['outsider', as(w.f.ids.outsider), undefined],
      ['staff non-member', staffViewer(w), 'staff@twings.app'],
    ] as const) {
      stub.viewer = viewer;
      stub.verifiedEmail = email;
      await expect(renderPage({ organizationId: w.f.orgId }), label).rejects.toThrow('NEXT_NOT_FOUND');
    }

    // Closed organizations
    stub.verifiedEmail = undefined;
    stub.viewer = as(w.f.ids.owner);
    openSend('*');
    for (const how of ['sandboxed', 'generation', 'self_studio', 'project_only'] as const) {
      const orgId = how === 'sandboxed' ? [...SANDBOXED_CLIENT_ORG_IDS][0]! : randomUUID();
      await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
        orgId,
        `Closed ${how}`,
        w.f.ids.owner,
        randomUUID(),
      ]);
      await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
        orgId,
        w.f.ids.owner,
      ]);
      if (how === 'generation') {
        await w.f.sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])", [orgId]);
      }
      if (how === 'self_studio') {
        await w.f.sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio']::text[])", [orgId]);
      }
      if (how === 'project_only') {
        await w.f.sql.query("insert into brand_plan_assignments (organization_id, plan_id, started_on) values ($1, 'project_only', ((now() at time zone 'Asia/Seoul')::date - 1))", [orgId]);
      }
      await expect(renderPage({ organizationId: orgId }), how).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});
