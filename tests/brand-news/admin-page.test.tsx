import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { BRAND_NEWS_LIMITS } from '@/lib/brand-news/contracts';
import { resetBrandNewsProbe } from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { BrandNewsEditor } from '@/app/(admin)/admin/brand-news/brand-news-editor';
import {
  audienceNeedsExplicitChoice,
  describeBrandNewsAudience,
  emptyDraftForm,
  formatKstPeriod,
  formatPublishConfirmation,
  formValuesFromItem,
  isDirty,
  isoToKstLocalInput,
  resolveBrandNewsOutcome,
  validateDraftClient,
} from '@/app/(admin)/admin/brand-news/model';
import { studioFixture, type StudioFixture } from '../brand-studio/server/helpers';
import { mountDom, type MountedDom } from '../brands/_dom-harness';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: {
    tier: 'admin',
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'admin@twings.app',
    isAdmin: true,
    locale: 'ko',
  } as Viewer,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/i18n/server', () => ({
  getLocaleFromHeaders: async () => 'ko' as const,
}));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({
    admin: true,
    brand: false,
    workspace: true,
    origin: 'https://admin.twings.app',
  }),
  publicHref: (p: string, admin: boolean) => (admin ? `https://twings.app${p}` : p),
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => mocks.viewer,
  getViewer: async () => mocks.viewer,
}));
vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => mocks.sql,
}));

const AdminBrandNewsPage = (await import('@/app/(admin)/admin/brand-news/page')).default;
const AdminHomePage = (await import('@/app/(admin)/admin/page')).default;

async function renderAsyncHtml(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

let fixture: StudioFixture | null = null;
let mounted: MountedDom | null = null;
const originalFetch = globalThis.fetch;

afterEach(async () => {
  vi.unstubAllEnvs();
  resetBrandNewsProbe();
  globalThis.fetch = originalFetch;
  if (mounted) {
    await mounted.unmount();
    mounted = null;
  }
  if (fixture) {
    await fixture.db.close();
    fixture = null;
  }
  mocks.sql = null;
});

async function seedAdminAnnouncement(
  fx: StudioFixture,
  opts: {
    id?: string;
    status: 'draft' | 'live' | 'ended';
    titleKo: string;
    titleEn?: string;
    shape?: 'line' | 'banner';
    ctaHref?: string;
    audience?: Record<string, unknown>;
    startsOffsetMs?: number;
    endsOffsetMs?: number;
    createdAtOffsetMs?: number;
    createdBy?: string | null;
  },
) {
  const id = opts.id ?? randomUUID();
  const now = Date.now();
  const startsAt = new Date(now + (opts.startsOffsetMs ?? -3600_000)).toISOString();
  const endsAt = new Date(now + (opts.endsOffsetMs ?? 7 * 86_400_000)).toISOString();
  const createdAt = new Date(now + (opts.createdAtOffsetMs ?? 0)).toISOString();
  const publishedAt = opts.status !== 'draft' ? createdAt : null;
  const endedAt = opts.status === 'ended' ? new Date(now - 60_000).toISOString() : null;
  await fx.sql.query(
    `insert into brand_announcements
       (id, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience, status, created_by, created_at, updated_at, published_at, ended_at)
     values ($1, '새 소식', 'New', $2, $3, '보기', 'View', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $11, $12, $13)`,
    [
      id,
      opts.titleKo,
      opts.titleEn ?? 'English sentence',
      opts.ctaHref ?? '/brand/studio/video',
      opts.shape ?? 'line',
      startsAt,
      endsAt,
      JSON.stringify(opts.audience ?? {}),
      opts.status,
      opts.createdBy ?? null,
      createdAt,
      publishedAt,
      endedAt,
    ],
  );
  return id;
}

describe('admin brand-news pure model', () => {
  const copy = getDictionary('ko').brandNewsAdmin;

  it('converts UTC ISO instants to exact KST local datetime inputs across day boundaries', () => {
    expect(isoToKstLocalInput('2026-12-01T01:00:00.000Z')).toBe('2026-12-01T10:00');
    expect(isoToKstLocalInput('2026-12-01T20:30:00.000Z')).toBe('2026-12-02T05:30');
    expect(formatKstPeriod('2026-12-01T01:00:00.000Z', '2026-12-15T14:59:00.000Z')).toBe(
      '2026-12-01 10:00 ~ 2026-12-15 23:59 KST',
    );
  });

  it('summarises audience rules cleanly in words without raw UUIDs', () => {
    expect(describeBrandNewsAudience({}, copy)).toBe(copy.audienceSummary.defaultAll);
    expect(describeBrandNewsAudience({ modes: ['make', 'team'], plans: ['b2b_49'] }, copy)).toContain(copy.modeNames.team);
    expect(describeBrandNewsAudience({ orgs: [randomUUID(), randomUUID()] }, copy)).toBe(
      interpolate(copy.audienceSummary.orgsCount, { count: '2' }),
    );
    expect(describeBrandNewsAudience(null, copy)).toBe(copy.audienceSummary.invalid);
  });

  it('maps every contract §5.4 refusal and success code to dedicated admin wording', () => {
    expect(resolveBrandNewsOutcome({ ok: 'published', detail: randomUUID() }, copy)?.bannerMessage).toBe(copy.outcomes.published);
    expect(resolveBrandNewsOutcome({ err: 'disabled', detail: 'BRAND_NEWS' }, copy)?.bannerMessage).toBe(copy.disabled);
    expect(resolveBrandNewsOutcome({ err: 'disabled', detail: 'brandNews:migration 0196/0197 not applied' }, copy)?.bannerMessage).toBe(copy.migrationMissing);
    expect(resolveBrandNewsOutcome({ err: 'notFound', detail: 'brandNews:id' }, copy)?.bannerMessage).toBe(copy.outcomes.notFound);
    expect(resolveBrandNewsOutcome({ err: 'notDraft', detail: 'brandNews:live' }, copy)?.bannerMessage).toBe(copy.outcomes.notDraftLive);
    expect(resolveBrandNewsOutcome({ err: 'notDraft', detail: 'brandNews:ended' }, copy)?.bannerMessage).toBe(copy.outcomes.notDraftEnded);
    expect(resolveBrandNewsOutcome({ err: 'badTransition', detail: 'brandNews:notLive' }, copy)?.bannerMessage).toBe(copy.outcomes.badTransitionNotLive);
    expect(resolveBrandNewsOutcome({ err: 'badTransition', detail: 'brandNews:slotBusy' }, copy)?.bannerMessage).toBe(copy.outcomes.badTransitionSlotBusy);

    const hrefTraversal = resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:ctaHref:traversal' }, copy);
    expect(hrefTraversal?.bannerMessage).toBeNull();
    expect(hrefTraversal?.fieldMessages.ctaHref).toBe(copy.outcomes.hrefTraversal);

    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:ctaHref:notAllowed' }, copy)?.fieldMessages.ctaHref).toBe(copy.outcomes.hrefNotAllowed);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:ctaHref:characters' }, copy)?.fieldMessages.ctaHref).toBe(copy.outcomes.hrefCharacters);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:ctaHref:tooLong' }, copy)?.fieldMessages.ctaHref).toContain(String(BRAND_NEWS_LIMITS.hrefChars));

    for (const fName of ['kickerKo', 'kickerEn', 'titleKo', 'titleEn', 'ctaLabelKo', 'ctaLabelEn'] as const) {
      expect(resolveBrandNewsOutcome({ err: 'invalid', detail: `brandNews:${fName}:tooLong` }, copy)?.fieldMessages[fName]).toContain(copy.fields[fName]);
      expect(resolveBrandNewsOutcome({ err: 'invalid', detail: `brandNews:${fName}:characters` }, copy)?.fieldMessages[fName]).toContain(copy.fields[fName]);
    }

    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:shape' }, copy)?.fieldMessages.shape).toBe(copy.outcomes.invalidShape);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:startsAt' }, copy)?.fieldMessages.startsAt).toBe(copy.outcomes.invalidStartsAt);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:endsAt' }, copy)?.fieldMessages.endsAt).toBe(copy.outcomes.invalidEndsAt);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:period' }, copy)?.fieldMessages.period).toContain(String(BRAND_NEWS_LIMITS.periodMaxDays));
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:audience' }, copy)?.fieldMessages.audience).toContain(String(BRAND_NEWS_LIMITS.audienceOrgsMax));
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:audience:json' }, copy)?.fieldMessages.audience).toBe(copy.outcomes.invalidAudienceJson);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:audience:twoWays' }, copy)?.fieldMessages.audience).toBe(copy.outcomes.invalidAudienceTwoWays);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:audience:unknownKey' }, copy)?.fieldMessages.audience).toBe(copy.outcomes.invalidAudienceUnknownKey);
    expect(resolveBrandNewsOutcome({ err: 'invalid', detail: 'brandNews:image:notBanner' }, copy)?.fieldMessages.image).toBe(copy.outcomes.imageNotBanner);

    expect(resolveBrandNewsOutcome({ err: 'upload', detail: 'brandNews:image:tooLarge' }, copy)?.fieldMessages.image).toBeTruthy();
    expect(resolveBrandNewsOutcome({ err: 'upload', detail: 'brandNews:image:type' }, copy)?.fieldMessages.image).toBe(copy.outcomes.imageType);
    expect(resolveBrandNewsOutcome({ err: 'upload', detail: 'brandNews:image:unreadable' }, copy)?.fieldMessages.image).toBe(copy.outcomes.imageUnreadable);
    expect(resolveBrandNewsOutcome({ err: 'upload', detail: 'brandNews:image:size 800x200' }, copy)?.fieldMessages.image).toContain('800x200');
    expect(resolveBrandNewsOutcome({ err: 'upload', detail: 'brandNews:image:bytes 512000' }, copy)?.fieldMessages.image).toContain('500KB');
    expect(resolveBrandNewsOutcome({ err: 'storage', detail: 'brandNews:image:store' }, copy)?.fieldMessages.image).toBe(copy.outcomes.imageStore);

    const notPub = resolveBrandNewsOutcome(
      { err: 'notPublishable', detail: 'brandNews:titleKo,titleEn,link,image,period,over,audience' },
      copy,
    );
    expect(notPub?.bannerMessage).toContain(copy.publishReadiness.reasons.over);
    expect(notPub?.fieldMessages.titleKo).toBe(copy.publishReadiness.reasons.titleKo);
    expect(notPub?.fieldMessages.titleEn).toBe(copy.publishReadiness.reasons.titleEn);
    expect(notPub?.fieldMessages.ctaHref).toBe(copy.publishReadiness.reasons.link);
    expect(notPub?.fieldMessages.image).toBe(copy.publishReadiness.reasons.image);
    expect(notPub?.fieldMessages.period).toBe(copy.publishReadiness.reasons.period);
    expect(notPub?.fieldMessages.endsAt).toBe(copy.publishReadiness.reasons.over);
    expect(notPub?.fieldMessages.audience).toBe(copy.publishReadiness.reasons.audience);
  });

  it('detects form dirtiness on every field while normalizing whitespace and the organization UUID set', () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const base = {
      ...emptyDraftForm(new Date('2026-12-01T01:00:00.000Z')),
      id: randomUUID(),
      kickerKo: '새 소식',
      kickerEn: 'New',
      titleKo: '한국어 문구',
      titleEn: 'English line',
      ctaLabelKo: '보기',
      ctaLabelEn: 'View',
      ctaHref: '/brand/studio',
      modes: ['make'] as const,
      plans: ['b2b_29', 'b2b_49'] as const,
      orgsText: `${orgA}\n${orgB}`,
    };
    const initial = { ...base, modes: [...base.modes], plans: [...base.plans] };

    expect(isDirty(initial, initial)).toBe(false);
    // Trimmed text whitespace and reordered/uppercased/comma-separated org UUIDs stay clean.
    expect(
      isDirty(
        {
          ...initial,
          kickerKo: '  새 소식 ',
          plans: ['b2b_49', 'b2b_29'],
          orgsText: ` ${orgB.toUpperCase()} , ${orgA}\n${orgB} `,
        },
        initial,
      ),
    ).toBe(false);

    // Every actual field edit makes the form dirty (including untrimmed spaces in ctaHref!).
    expect(isDirty({ ...initial, kickerKo: '공지' }, initial)).toBe(true);
    expect(isDirty({ ...initial, kickerEn: 'Notice' }, initial)).toBe(true);
    expect(isDirty({ ...initial, titleKo: '다른 문구' }, initial)).toBe(true);
    expect(isDirty({ ...initial, titleEn: 'Other line' }, initial)).toBe(true);
    expect(isDirty({ ...initial, ctaLabelKo: '열기' }, initial)).toBe(true);
    expect(isDirty({ ...initial, ctaLabelEn: 'Open' }, initial)).toBe(true);
    expect(isDirty({ ...initial, ctaHref: '/brand/studio ' }, initial)).toBe(true);
    expect(isDirty({ ...initial, shape: 'banner' }, initial)).toBe(true);
    expect(isDirty({ ...initial, startsAtLocal: '2026-12-02T10:00' }, initial)).toBe(true);
    expect(isDirty({ ...initial, endsAtLocal: '2026-12-16T10:00' }, initial)).toBe(true);
    expect(isDirty({ ...initial, modes: ['make', 'team'] }, initial)).toBe(true);
    expect(isDirty({ ...initial, plans: ['b2b_29'] }, initial)).toBe(true);
    expect(isDirty({ ...initial, orgsText: orgA }, initial)).toBe(true);
    expect(isDirty(initial, initial, { hasPendingImage: true })).toBe(true);
    expect(isDirty(initial, initial, { storedAudienceNull: true })).toBe(true);
  });

  it('requires a plan, org list, or explicit everyone choice (modes alone stay blocked) when stored audience is null, and validates links client-side', () => {
    const base = { ...emptyDraftForm(new Date('2026-12-01T01:00:00.000Z')), titleKo: '문구', ctaHref: '/brand/studio' };
    expect(audienceNeedsExplicitChoice(true, base, false)).toBe(true);
    expect(audienceNeedsExplicitChoice(true, { ...base, modes: ['make'] }, false)).toBe(true);
    expect(audienceNeedsExplicitChoice(true, { ...base, modes: ['team'] }, false)).toBe(true);
    expect(audienceNeedsExplicitChoice(true, { ...base, modes: ['make', 'team'] }, false)).toBe(true);
    expect(audienceNeedsExplicitChoice(true, base, true)).toBe(false);
    expect(audienceNeedsExplicitChoice(true, { ...base, plans: ['b2b_49'] }, false)).toBe(false);
    expect(audienceNeedsExplicitChoice(true, { ...base, orgsText: randomUUID() }, false)).toBe(false);
    expect(audienceNeedsExplicitChoice(false, base, false)).toBe(false);

    const nullErrs = validateDraftClient(base, copy, {
      hasPendingImage: false,
      storedAudienceNull: true,
      explicitAllSelected: false,
    });
    expect(nullErrs.audience).toBe(copy.audienceSummary.invalid);

    const modesOnlyErrs = validateDraftClient({ ...base, modes: ['team'] }, copy, {
      hasPendingImage: false,
      storedAudienceNull: true,
      explicitAllSelected: false,
    });
    expect(modesOnlyErrs.audience).toBe(copy.audienceSummary.invalid);

    const fixedErrs = validateDraftClient(base, copy, {
      hasPendingImage: false,
      storedAudienceNull: true,
      explicitAllSelected: true,
    });
    expect(fixedErrs.audience).toBeUndefined();

    // Empty link stays valid on line drafts, while refused non-empty links fail before submit.
    const emptyLineErrs = validateDraftClient({ ...base, ctaHref: '' }, copy, {
      hasPendingImage: false,
      storedAudienceNull: false,
      explicitAllSelected: false,
    });
    expect(emptyLineErrs.ctaHref).toBeUndefined();
    expect(
      validateDraftClient({ ...base, ctaHref: 'https://example.com' }, copy, {
        hasPendingImage: false,
        storedAudienceNull: false,
        explicitAllSelected: false,
      }).ctaHref,
    ).toBe(copy.outcomes.hrefNotAllowed);
  });

  it('formats publish confirmations without "즉시" and includes KST start time when start is ahead', () => {
    const draftId = randomUUID();
    const nowMs = Date.parse('2026-12-01T01:00:00.000Z');
    const pastConfirm = formatPublishConfirmation({
      liveItem: null,
      selectedId: draftId,
      startsAtIso: '2026-11-30T01:00:00.000Z',
      nowMs,
      copy,
    });
    expect(pastConfirm).toBe(copy.actions.confirmPublishLabel);
    expect(pastConfirm).not.toContain('즉시');

    const futureConfirm = formatPublishConfirmation({
      liveItem: null,
      selectedId: draftId,
      startsAtIso: '2026-12-05T01:00:00.000Z',
      nowMs,
      copy,
    });
    expect(futureConfirm).toContain('2026-12-05 10:00 KST');
    expect(futureConfirm).not.toContain('즉시');
  });
});

describe('AdminBrandNewsPage server rendering', () => {
  const copy = getDictionary('ko').brandNewsAdmin;
  const adminCopy = getDictionary('ko').admin;

  it('shows only one plain disabled sentence and no form when BRAND_NEWS is off', async () => {
    vi.stubEnv('BRAND_NEWS', 'off');
    fixture = await studioFixture({ orgName: 'Admin News Brand' });
    mocks.sql = fixture.sql;

    const el = (await AdminBrandNewsPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    const html = await renderAsyncHtml(el);

    expect(html).toContain('data-brand-news-disabled="flag"');
    expect(html).toContain(copy.disabled);
    expect(html).not.toContain('name="titleKo"');
    expect(html).not.toContain('value="brandNews.save"');
    expect(html).not.toContain('data-brand-news-row=');
  });

  it('shows migration missing sentence and no form when tables are absent', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    fixture = await studioFixture({ orgName: 'Admin News NoTable' });
    await fixture.sql.query('drop table if exists brand_news_dismissals, brand_announcements cascade');
    mocks.sql = fixture.sql;

    const html = await renderAsyncHtml((await AdminBrandNewsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain('data-brand-news-disabled="migration"');
    expect(html).toContain(copy.migrationMissing);
    expect(html).not.toContain('name="titleKo"');
  });

  it('renders newest-first list, hides author, displays draft reach, and names live item in publish confirm', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    fixture = await studioFixture({ orgName: 'Reachable Org' });
    mocks.sql = fixture.sql;

    // Update profile email to ensure author identity never leaks onto the admin screen.
    await fixture.sql.query('update profiles set email = $1 where id = $2', ['SecretAuthor@example.test', fixture.ids.admin]);

    const endedId = await seedAdminAnnouncement(fixture, {
      status: 'ended',
      titleKo: '지난 공지 문구',
      createdAtOffsetMs: -20_000,
      createdBy: fixture.ids.admin,
    });
    const liveId = await seedAdminAnnouncement(fixture, {
      status: 'live',
      titleKo: '지금 켜진 대표 공지',
      createdAtOffsetMs: -10_000,
      createdBy: fixture.ids.admin,
    });
    const draftId = await seedAdminAnnouncement(fixture, {
      status: 'draft',
      titleKo: '새 초안 공지 문구',
      shape: 'line',
      createdAtOffsetMs: 0,
      createdBy: fixture.ids.admin,
    });

    const html = await renderAsyncHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ edit: draftId }) })) as ReactElement,
    );

    const draftIdx = html.indexOf(`data-brand-news-row="${draftId}"`);
    const liveIdx = html.indexOf(`data-brand-news-row="${liveId}"`);
    const endedIdx = html.indexOf(`data-brand-news-row="${endedId}"`);
    expect(draftIdx).toBeGreaterThan(-1);
    expect(liveIdx).toBeGreaterThan(draftIdx);
    expect(endedIdx).toBeGreaterThan(liveIdx);

    expect(html).toContain(copy.statuses.draft);
    expect(html).toContain(copy.statuses.live);
    expect(html).toContain(copy.statuses.ended);
    expect(html).toContain(copy.shapes.line);
    expect(html).not.toContain('SecretAuthor@example.test');
    expect(html).not.toContain(fixture.ids.admin);

    // Reach for saved draft
    expect(html).toContain('data-brand-news-reach="1"');
    expect(html).toContain(copy.reach.note);

    // Publish confirmation explicitly names the live row that will be ended, and both controls start disabled on SSR until hydrated
    expect(html).toContain(`data-brand-news-publish-replaces="${liveId}"`);
    const decodedHtml = html.replaceAll('&quot;', '"');
    expect(decodedHtml).toContain(
      interpolate(copy.actions.confirmPublishReplaceSlotLabel, {
        slot: copy.slots.home.short,
        title: '지금 켜진 대표 공지',
      }),
    );
    expect(html).toContain('data-brand-news-publish=""');
    expect(html).toMatch(/disabled=""[^>]*data-brand-news-publish=""|data-brand-news-publish=""[^>]*disabled=""/);
    expect(html).toMatch(/name="_confirm"[^>]*disabled=""|disabled=""[^>]*name="_confirm"/);
    expect(html).not.toContain('data-brand-news-dirty-notice=""');

    // Also verifies redirect after create (?ok=created&detail=<draftId>) selects the newly created draft.
    const createdHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ ok: 'created', detail: draftId }) })) as ReactElement,
    );
    expect(createdHtml).toContain(copy.outcomes.created);
    expect(createdHtml).toContain('data-brand-news-reach="1"');

    // Future-start draft mentions KST start time in publish confirmation without "즉시".
    const futureDraftId = await seedAdminAnnouncement(fixture, {
      status: 'draft',
      titleKo: '예약 공지 문구',
      startsOffsetMs: 2 * 86_400_000,
      endsOffsetMs: 9 * 86_400_000,
    });
    const futureHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ edit: futureDraftId }) })) as ReactElement,
    );
    expect(futureHtml).toContain('KST부터 직접 만들기 홈에 노출됩니다');
    expect(futureHtml).not.toContain('즉시');
  });

  it('locks save and publish when stored audience is unparseable (null) until explicitly set again', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    fixture = await studioFixture({ orgName: 'Admin NullAudience Brand' });
    mocks.sql = fixture.sql;

    const badDraftId = await seedAdminAnnouncement(fixture, {
      status: 'draft',
      titleKo: '읽기 불가 대상 초안',
      audience: { unknownKey: true },
    });

    const html = await renderAsyncHtml(
      (await AdminBrandNewsPage({ searchParams: Promise.resolve({ edit: badDraftId }) })) as ReactElement,
    );
    expect(html).toContain('data-brand-news-audience-invalid=""');
    expect(html).toContain(copy.audienceSummary.invalid);
    expect(html).toContain('data-brand-news-audience-all=""');
    expect(html).toMatch(/disabled=""[^>]*data-brand-news-save=""|data-brand-news-save=""[^>]*disabled=""/);
    expect(html).toMatch(/disabled=""[^>]*data-brand-news-publish=""|data-brand-news-publish=""[^>]*disabled=""/);
  });

  it('makes live and ended rows read-only and never renders generic OutcomeBanner wording for brandNews refusals', async () => {
    vi.stubEnv('BRAND_NEWS', 'on');
    fixture = await studioFixture({ orgName: 'Admin ReadOnly Brand' });
    mocks.sql = fixture.sql;

    const liveId = await seedAdminAnnouncement(fixture, { status: 'live', titleKo: '노출 중인 공지' });
    const endedId = await seedAdminAnnouncement(fixture, { status: 'ended', titleKo: '끝난 공지' });

    const liveHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ edit: liveId, err: 'notDraft', detail: 'brandNews:live' }),
      })) as ReactElement,
    );
    expect(liveHtml).toContain('data-brand-news-readonly=""');
    expect(liveHtml).not.toContain('data-brand-news-save=""');
    expect(liveHtml).not.toContain('data-brand-news-publish=""');
    expect(liveHtml).toContain('data-brand-news-end=""');
    expect(liveHtml).toContain(copy.outcomes.notDraftLive);
    expect(liveHtml).not.toContain(adminCopy.errNotDraft);

    const endedHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ edit: endedId, err: 'badTransition', detail: 'brandNews:slotBusy' }),
      })) as ReactElement,
    );
    expect(endedHtml).toContain('data-brand-news-readonly=""');
    expect(endedHtml).not.toContain('data-brand-news-save=""');
    expect(endedHtml).not.toContain('data-brand-news-end=""');
    expect(endedHtml).toContain(copy.outcomes.badTransitionSlotBusy);
    expect(endedHtml).not.toContain('현재 상태 → 요청 상태');

    const okPubHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ edit: liveId, ok: 'published', detail: liveId }),
      })) as ReactElement,
    );
    expect(okPubHtml).toContain(copy.outcomes.published);
    expect(okPubHtml).not.toContain(adminCopy.okPublished);

    const hrefErrHtml = await renderAsyncHtml(
      (await AdminBrandNewsPage({
        searchParams: Promise.resolve({ err: 'invalid', detail: 'brandNews:ctaHref:traversal' }),
      })) as ReactElement,
    );
    expect(hrefErrHtml).toContain(copy.outcomes.hrefTraversal);
    expect(hrefErrHtml).not.toContain('data-brand-news-outcome=');
  });

  it('links to /admin/brand-news from the admin home', async () => {
    mocks.sql = null;
    const html = await renderAsyncHtml((await AdminHomePage()) as ReactElement);
    expect(html).toContain('href="/admin/brand-news"');
    expect(html).toContain(copy.title);
  });
});

describe('BrandNewsEditor interactive counters and 1440px live preview', () => {
  it('updates character counters and ko/en 1440px HomeNewsLine previews live with zero network calls', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const koDict = getDictionary('ko');
    const enDict = getDictionary('en');

    mounted = await mountDom(
      <BrandNewsEditor
        selected={null}
        liveItem={null}
        initialValues={emptyDraftForm(new Date('2026-12-01T01:00:00.000Z'))}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={koDict.brandNewsAdmin}
        homeCopyKo={koDict.brandNews}
        homeCopyEn={enDict.brandNews}
      />,
    );

    expect(mounted.query('[data-brand-news-preview="ko"] [data-preview-width="1440"]')).not.toBeNull();
    expect(mounted.query('[data-brand-news-preview="en"] [data-preview-width="1440"]')).not.toBeNull();
    expect(mounted.query('[data-brand-news-preview-empty="ko"]')).not.toBeNull();

    await mounted.setValue('input[name="titleKo"]', '미리보기 한국어 문구');
    await mounted.setValue('input[name="titleEn"]', 'Preview English line');
    await mounted.setValue('input[name="ctaHref"]', '/brand/studio/video');

    const titleKoCounter = mounted.query('[data-brand-news-field="titleKo"] [data-counter]');
    expect(titleKoCounter?.getAttribute('data-counter')).toBe(`11/${BRAND_NEWS_LIMITS.titleChars}`);

    await mounted.setValue('input[name="titleEn"]', 'a'.repeat(BRAND_NEWS_LIMITS.titleChars + 1));
    const overCounter = mounted.query('[data-brand-news-field="titleEn"] [data-counter]');
    expect(overCounter?.getAttribute('data-counter')).toBe(
      `${BRAND_NEWS_LIMITS.titleChars + 1}/${BRAND_NEWS_LIMITS.titleChars}`,
    );

    const koPreviewLine = mounted.query('[data-brand-news-preview="ko"] [data-home-news]');
    const enPreviewLine = mounted.query('[data-brand-news-preview="en"] [data-home-news]');
    expect(koPreviewLine?.textContent).toContain('미리보기 한국어 문구');
    expect(enPreviewLine?.textContent).toContain('a'.repeat(BRAND_NEWS_LIMITS.titleChars + 1));
    expect(fetchMock).not.toHaveBeenCalled();

    // Switching shape to banner shows image upload; switching back removes it.
    const bannerRadio = mounted.query('input[data-brand-news-shape="banner"]') as { checked: boolean } | null;
    if (bannerRadio) bannerRadio.checked = true;
    await mounted.click('input[data-brand-news-shape="banner"]');
    expect(mounted.query('input[name="image"]')).not.toBeNull();
    const lineRadio = mounted.query('input[data-brand-news-shape="line"]') as { checked: boolean } | null;
    if (lineRadio) lineRadio.checked = true;
    await mounted.click('input[data-brand-news-shape="line"]');
    expect(mounted.query('input[name="image"]')).toBeNull();
  });

  it('renders 1440px banner previews and prefilled audience selections for a saved banner draft', async () => {
    const koDict = getDictionary('ko');
    const enDict = getDictionary('en');
    const orgA = randomUUID();
    const draftId = randomUUID();
    const initial = formValuesFromItem({
      id: draftId,
      slot: 'home',
      status: 'draft',
      showing: false,
      over: false,
      kickerKo: '신규',
      kickerEn: 'New',
      titleKo: '배너 공지 문구',
      titleEn: 'Banner news line',
      ctaLabelKo: '열기',
      ctaLabelEn: 'Open',
      ctaHref: '/brand/studio/video',
      shape: 'banner',
      imageKey: 'abcd.webp',
      imageWidth: BRAND_NEWS_LIMITS.image.width,
      imageHeight: BRAND_NEWS_LIMITS.image.height,
      imageUrl: 'https://media.example.test/public-content/abcd.webp',
      startsAt: '2026-12-01T01:00:00.000Z',
      endsAt: '2026-12-10T01:00:00.000Z',
      audience: { modes: ['make', 'team'], plans: ['b2b_49'], orgs: [orgA] },
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      publishedAt: null,
      endedAt: null,
      publishable: { ok: true },
    });

    const html = await renderAsyncHtml(
      <BrandNewsEditor
        selected={null}
        liveItem={null}
        initialValues={initial}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={koDict.brandNewsAdmin}
        homeCopyKo={koDict.brandNews}
        homeCopyEn={enDict.brandNews}
      />,
    );

    expect(html).toContain('data-brand-workspace="');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-shape="banner"');
    expect(html).not.toContain('bs-tile-btn');
    expect(html).toContain('src="https://media.example.test/public-content/abcd.webp"');
    expect(html).toContain('2026-12-01T10:00');
    expect(html).toContain('2026-12-10T10:00');
    expect(html).toContain(orgA);
  });

  it('disables publish on dirty audience list (and re-enables on revert), blocks unreadable null audience, prevents invalid saves, and stops double submits', async () => {
    const koDict = getDictionary('ko');
    const enDict = getDictionary('en');
    const draftId = randomUUID();
    const orgA = randomUUID();
    const baseDraft = {
      id: draftId,
      slot: 'home' as const,
      status: 'draft' as const,
      showing: false,
      over: false,
      kickerKo: '새 소식',
      kickerEn: 'New',
      titleKo: '저장된 초안 문구',
      titleEn: 'Saved draft sentence',
      ctaLabelKo: '보기',
      ctaLabelEn: 'View',
      ctaHref: '/brand/studio/video',
      shape: 'line' as const,
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      imageUrl: null,
      startsAt: '2026-12-01T01:00:00.000Z',
      endsAt: '2026-12-15T01:00:00.000Z',
      audience: {} as const,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      publishedAt: null,
      endedAt: null,
      publishable: { ok: true as const },
    };

    const cleanEditor = (
      <BrandNewsEditor
        selected={baseDraft}
        liveItem={null}
        initialValues={formValuesFromItem(baseDraft)}
        nowMs={Date.parse('2026-11-27T00:00:00.000Z')}
        reach={{ ok: true, organizations: 4 }}
        studioV2Enabled
        outcome={null}
        copy={koDict.brandNewsAdmin}
        homeCopyKo={koDict.brandNews}
        homeCopyEn={enDict.brandNews}
      />
    );
    const cleanSsr = await renderAsyncHtml(cleanEditor);
    expect(cleanSsr).toMatch(/disabled=""[^>]*data-brand-news-publish=""|data-brand-news-publish=""[^>]*disabled=""/);
    expect(cleanSsr).toMatch(/name="_confirm"[^>]*disabled=""|disabled=""[^>]*name="_confirm"/);

    mounted = await mountDom(cleanEditor);

    const publishBtn = () => mounted!.query('[data-brand-news-publish]') as { disabled: boolean };
    const confirmInput = () => mounted!.query('[data-brand-news-publish-box] input[name="_confirm"]') as { disabled: boolean };
    const saveBtn = () => mounted!.query('[data-brand-news-save]') as { disabled: boolean };

    // 1. Clean draft: publish and confirm are enabled.
    expect(publishBtn().disabled).toBe(false);
    expect(confirmInput().disabled).toBe(false);
    expect(mounted.query('[data-brand-news-dirty-notice]')).toBeNull();

    // Type one org UUID into the audience list -> publish & confirm disable and notice shows.
    await mounted.setValue('textarea[name="audienceOrgs"]', orgA);
    expect(publishBtn().disabled).toBe(true);
    expect(confirmInput().disabled).toBe(true);
    expect(mounted.query('[data-brand-news-dirty-notice]')?.textContent).toBe(koDict.brandNewsAdmin.actions.saveBeforePublish);

    // Revert the change -> publish & confirm re-enable cleanly.
    await mounted.setValue('textarea[name="audienceOrgs"]', '');
    expect(publishBtn().disabled).toBe(false);
    expect(confirmInput().disabled).toBe(false);
    expect(mounted.query('[data-brand-news-dirty-notice]')).toBeNull();

    // 3a. Client save guard: text counter over limit -> save disabled + field error inline.
    await mounted.setValue('input[name="titleEn"]', 'x'.repeat(BRAND_NEWS_LIMITS.titleChars + 1));
    expect(saveBtn().disabled).toBe(true);
    expect(mounted.query('[data-brand-news-field="titleEn"] p')?.textContent).toContain(koDict.brandNewsAdmin.fields.titleEn);
    await mounted.setValue('input[name="titleEn"]', 'Saved draft sentence');
    expect(saveBtn().disabled).toBe(false);

    // 3b. Client save guard: end not after start -> save disabled + inline period error.
    await mounted.setValue('input[name="endsAt"]', '2026-12-01T10:00');
    expect(saveBtn().disabled).toBe(true);
    expect(mounted.query('[data-brand-news-field="period"] p[role="alert"]')?.textContent).toContain(
      String(BRAND_NEWS_LIMITS.periodMaxDays),
    );

    // 3c. Client save guard: span > periodMaxDays -> save disabled + inline period error.
    await mounted.setValue('input[name="endsAt"]', '2027-02-10T10:00');
    expect(saveBtn().disabled).toBe(true);
    expect(mounted.query('[data-brand-news-field="period"] p[role="alert"]')?.textContent).toContain(
      String(BRAND_NEWS_LIMITS.periodMaxDays),
    );
    await mounted.setValue('input[name="endsAt"]', '2026-12-15T10:00');
    expect(saveBtn().disabled).toBe(false);

    // 3d. Client save guard: banner without picture and empty link -> save disabled + inline ctaHref error.
    const bannerRadio = mounted.query('input[data-brand-news-shape="banner"]') as { checked: boolean };
    bannerRadio.checked = true;
    await mounted.click('input[data-brand-news-shape="banner"]');
    await mounted.setValue('input[name="ctaHref"]', '');
    expect(saveBtn().disabled).toBe(true);
    expect(mounted.query('[data-brand-news-field="ctaHref"] p[role="alert"]')?.textContent).toBe(
      koDict.brandNewsAdmin.outcomes.hrefEmptyForBanner,
    );
    await mounted.setValue('input[name="ctaHref"]', '/brand/studio/video');
    expect(saveBtn().disabled).toBe(false);

    // 5. Double submit guard: two submits -> first submits natively (dispatchEvent returns true) and disables button,
    // second is prevented (dispatchEvent returns false); verify on both Save and Publish forms.
    const saveFormEl = (mounted.queryAll('form') as Array<{
      querySelector: (s: string) => unknown;
      dispatchEvent: (ev: unknown) => boolean;
    }>).find((f) => Boolean(f.querySelector('[data-brand-news-save]')))!;
    const origSaveDispatch = saveFormEl.dispatchEvent.bind(saveFormEl);
    const saveAllowed: boolean[] = [];
    saveFormEl.dispatchEvent = (ev: unknown) => {
      const ok = origSaveDispatch(ev);
      saveAllowed.push(ok);
      return ok;
    };
    await mounted.submit(saveFormEl as never);
    expect(saveBtn().disabled).toBe(true);
    await mounted.submit(saveFormEl as never);
    expect(saveAllowed).toEqual([true, false]);

    const publishFormEl = (mounted.queryAll('form') as Array<{
      querySelector: (s: string) => unknown;
      dispatchEvent: (ev: unknown) => boolean;
    }>).find((f) => Boolean(f.querySelector('[data-brand-news-publish]')))!;
    const origPublishDispatch = publishFormEl.dispatchEvent.bind(publishFormEl);
    const publishAllowed: boolean[] = [];
    publishFormEl.dispatchEvent = (ev: unknown) => {
      const ok = origPublishDispatch(ev);
      publishAllowed.push(ok);
      return ok;
    };
    await mounted.submit(publishFormEl as never);
    expect(publishBtn().disabled).toBe(true);
    expect(confirmInput().disabled).toBe(true);
    await mounted.submit(publishFormEl as never);
    expect(publishAllowed).toEqual([true, false]);

    await mounted.unmount();
    mounted = null;

    // 2. Unreadable stored audience (`audience: null`): modes alone stay blocked until plan, org list, or everyone control is chosen.
    const brokenDraft = { ...baseDraft, audience: null };
    mounted = await mountDom(
      <BrandNewsEditor
        selected={brokenDraft}
        liveItem={null}
        initialValues={formValuesFromItem(brokenDraft)}
        nowMs={Date.parse('2026-11-27T00:00:00.000Z')}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={koDict.brandNewsAdmin}
        homeCopyKo={koDict.brandNews}
        homeCopyEn={enDict.brandNews}
      />,
    );
    expect(saveBtn().disabled).toBe(true);
    expect(publishBtn().disabled).toBe(true);
    const makeModeBox = mounted.query('input[data-brand-news-mode="make"]') as { checked: boolean };
    makeModeBox.checked = true;
    await mounted.click('input[data-brand-news-mode="make"]');
    expect(saveBtn().disabled).toBe(true);
    const allCheckbox = mounted.query('input[data-brand-news-audience-all]') as { checked: boolean };
    allCheckbox.checked = true;
    await mounted.click('input[data-brand-news-audience-all]');
    expect(saveBtn().disabled).toBe(false);
    // Publish remains disabled until the repaired audience is saved first!
    expect(publishBtn().disabled).toBe(true);
  });

  it('blocks save with inline refusal sentences for rejected links while keeping typed values, and enables save for allowed links', async () => {
    const koDict = getDictionary('ko');
    const enDict = getDictionary('en');
    mounted = await mountDom(
      <BrandNewsEditor
        selected={null}
        liveItem={null}
        initialValues={emptyDraftForm(new Date('2026-12-01T01:00:00.000Z'))}
        nowMs={Date.parse('2026-12-01T00:00:00.000Z')}
        reach={null}
        studioV2Enabled
        outcome={null}
        copy={koDict.brandNewsAdmin}
        homeCopyKo={koDict.brandNews}
        homeCopyEn={enDict.brandNews}
      />,
    );

    const saveBtn = () => mounted!.query('[data-brand-news-save]') as { disabled: boolean };
    const titleKoInput = () => mounted!.query('input[name="titleKo"]') as { value: string };
    const hrefError = () => mounted!.query('[data-brand-news-field="ctaHref"] p[role="alert"]')?.textContent ?? null;

    await mounted.setValue('input[name="titleKo"]', '보존되어야 하는 제목');
    // Line draft with empty link stays saveable.
    expect(saveBtn().disabled).toBe(false);
    expect(hrefError()).toBeNull();

    for (const badHref of ['https://example.com', 'javascript:alert(1)', '/admin']) {
      await mounted.setValue('input[name="ctaHref"]', badHref);
      expect(saveBtn().disabled, `expected disabled save for ${badHref}`).toBe(true);
      expect(hrefError()).toBe(koDict.brandNewsAdmin.outcomes.hrefNotAllowed);
      expect(titleKoInput().value).toBe('보존되어야 하는 제목');
    }

    for (const goodHref of ['/brand/library', 'https://twings.app/ko']) {
      await mounted.setValue('input[name="ctaHref"]', goodHref);
      expect(saveBtn().disabled, `expected enabled save for ${goodHref}`).toBe(false);
      expect(hrefError()).toBeNull();
    }
  });
});

describe('Batch B source and CSS Module guards', () => {
  const ROOT = process.cwd();
  const ADMIN_NEWS_DIR = 'app/(admin)/admin/brand-news';

  const listFiles = (dir: string, ext: RegExp): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? listFiles(rel, ext) : ext.test(name) ? [rel] : [];
    });

  it('keeps admin/brand-news free of <video>, timers, and raw hardcoded limits, and keeps CSS Modules pure', () => {
    for (const file of listFiles(ADMIN_NEWS_DIR, /\.(ts|tsx)$/)) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, `${file} <video`).not.toMatch(/<video/i);
      expect(src, `${file} setInterval`).not.toMatch(/\bsetInterval\b/);
      expect(src, `${file} setTimeout`).not.toMatch(/\bsetTimeout\b/);
    }

    const pageSrc = readFileSync(path.join(ROOT, `${ADMIN_NEWS_DIR}/page.tsx`), 'utf8');
    expect(pageSrc).toContain("@/app/(brand)/workspace.css");

    const editorSrc = readFileSync(path.join(ROOT, `${ADMIN_NEWS_DIR}/brand-news-editor.tsx`), 'utf8');
    expect(editorSrc).toContain('BRAND_NEWS_LIMITS');
    expect(editorSrc).not.toMatch(/brand-news\/service|brand-news-operations/);

    const css = readFileSync(path.join(ROOT, `${ADMIN_NEWS_DIR}/brand-news.module.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(css).toContain('--ys-stage');
    expect(css).not.toContain('.bs-tile-btn');
    expect(css).not.toContain('.bs-icon');

    const selectors: string[] = [];
    const stack: Array<'at' | 'rule'> = [];
    let buf = '';
    for (const ch of css) {
      if (ch === '{') {
        const prelude = buf.trim();
        buf = '';
        if (prelude.startsWith('@')) {
          stack.push('at');
        } else {
          stack.push('rule');
          selectors.push(prelude);
        }
      } else if (ch === '}') {
        stack.pop();
        buf = '';
      } else if (stack[stack.length - 1] !== 'rule') {
        buf += ch;
      }
    }
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      for (const part of sel.split(',')) {
        expect(part.trim(), `impure CSS Modules selector: ${part}`).toMatch(/^\.[A-Za-z_][\w-]*/);
      }
    }
  });
});
