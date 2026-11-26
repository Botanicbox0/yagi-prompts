import '@/app/(brand)/workspace.css';
import { notFound } from 'next/navigation';
import { AdminShell, Panel } from '@/components/admin/chrome';
import { AdminPageHeader, AdminTable, StatusPill, type AdminTone } from '@/components/admin/patterns';
import { requireAdmin } from '@/lib/auth/viewer';
import { brandNewsSlotsReady, loadBrandNewsAdmin, loadBrandNewsReach } from '@/lib/brand-news/service';
import { BRAND_NEWS_SLOTS, type BrandNewsAdminItem, type BrandNewsStatus } from '@/lib/brand-news/contracts';
import { getSqlRunner } from '@/lib/db/connect';
import { brandNewsOpen, brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { BrandNewsEditor } from './brand-news-editor';
import {
  describeBrandNewsAudience,
  emptyDraftForm,
  formatKstPeriod,
  formValuesFromItem,
  resolveBrandNewsOutcome,
  resolveSelectedAnnouncementId,
} from './model';

export const dynamic = 'force-dynamic';

type RawQuery = Record<string, string | string[] | undefined>;

const scalar = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;

function statusTone(item: BrandNewsAdminItem): AdminTone {
  if (item.status === 'live') return item.showing ? 'done' : item.over ? 'hold' : 'progress';
  if (item.status === 'draft') return 'action';
  return 'hold';
}

function statusLabel(item: BrandNewsAdminItem, statuses: ReturnType<typeof getDictionary>['brandNewsAdmin']['statuses']): string {
  const base = statuses[item.status as BrandNewsStatus];
  if (item.showing) return `${base} · ${statuses.showingSuffix}`;
  if (item.over && item.status !== 'ended') return `${base} · ${statuses.overSuffix}`;
  return base;
}

export default async function AdminBrandNewsPage({
  searchParams,
}: {
  searchParams: Promise<RawQuery>;
}) {
  const [locale, sql, viewer, query] = await Promise.all([
    getLocaleFromHeaders(),
    getSqlRunner(),
    requireAdmin(),
    searchParams,
  ]);
  const dict = getDictionary(locale);
  const copy = dict.brandNewsAdmin;
  const homeCopyKo = getDictionary('ko').brandNews;
  const homeCopyEn = getDictionary('en').brandNews;

  const queryFlags = {
    edit: scalar(query.edit),
    ok: scalar(query.ok),
    err: scalar(query.err),
    detail: scalar(query.detail),
  };

  if (!brandNewsOpen()) {
    return (
      <AdminShell dict={dict.admin} locale={locale} active="brandNews">
        <AdminPageHeader title={copy.title} lede={copy.lede} />
        <p className="admin-empty" data-brand-news-disabled="flag">
          {copy.disabled}
        </p>
      </AdminShell>
    );
  }

  if (sql === null) {
    return (
      <AdminShell dict={dict.admin} locale={locale} active="brandNews">
        <AdminPageHeader title={copy.title} lede={copy.lede} />
        <p className="admin-empty" data-brand-news-disabled="database">
          {copy.noDatabase}
        </p>
      </AdminShell>
    );
  }

  const loaded = await loadBrandNewsAdmin({ sql }, viewer);
  if (!loaded.ok) {
    if (loaded.code === 'forbidden') notFound();
    return (
      <AdminShell dict={dict.admin} locale={locale} active="brandNews">
        <AdminPageHeader title={copy.title} lede={copy.lede} />
        <p className="admin-empty" data-brand-news-disabled="migration">
          {copy.migrationMissing}
        </p>
      </AdminShell>
    );
  }

  const items = loaded.items;
  const slotsReady = await brandNewsSlotsReady(sql);
  const liveItem = items.find((item) => item.status === 'live') ?? null;
  const liveItemsBySlot = BRAND_NEWS_SLOTS.map(
    (slot) => items.find((item) => item.slot === slot && item.status === 'live') ?? null,
  ).filter((item): item is BrandNewsAdminItem => item !== null);
  const selectedId = resolveSelectedAnnouncementId(queryFlags);
  const selected = selectedId ? (items.find((item) => item.id === selectedId) ?? null) : null;
  const liveForEditor = slotsReady
    ? (liveItemsBySlot.find((item) => item.slot === (selected?.slot ?? 'home')) ?? null)
    : liveItem;

  let outcome = resolveBrandNewsOutcome(queryFlags, copy);
  if (selectedId !== null && selected === null && outcome === null) {
    outcome = resolveBrandNewsOutcome({ err: 'notFound', detail: 'brandNews:id' }, copy);
  }

  const reach =
    selected && selected.status === 'draft'
      ? await loadBrandNewsReach({ sql }, viewer, selected.id)
      : null;
  const editorReach = reach?.ok ? { ok: true as const, organizations: reach.organizations } : null;

  const now = new Date();
  const initialValues = selected ? formValuesFromItem(selected) : emptyDraftForm(now);

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandNews">
      <AdminPageHeader
        title={copy.title}
        count={String(items.length)}
        lede={copy.lede}
        actions={
          <div className="admin-action-row">
            <a href="/admin/brand-news" className="admin-btn admin-btn-primary" data-brand-news-new="">
              + {copy.newDraft}
            </a>
          </div>
        }
      />

      <div className="space-y-6" data-brand-news-page="">
        {slotsReady ? (
          liveItemsBySlot.map((item) => (
            <div
              key={item.id}
              className="admin-outcome"
              data-outcome="ok"
              data-brand-news-live-summary={item.id}
              data-brand-news-live-slot={item.slot}
            >
              <p className="admin-outcome-title">
                {interpolate(copy.liveBannerTitleForSlot, { slot: copy.slots[item.slot].short })}:{' '}
                {item.titleKo || item.titleEn || item.id} (
                {item.showing ? copy.liveBannerShowing : copy.liveBannerScheduled})
              </p>
            </div>
          ))
        ) : liveItem ? (
          <div className="admin-outcome" data-outcome="ok" data-brand-news-live-summary={liveItem.id}>
            <p className="admin-outcome-title">
              {copy.liveBannerTitle}: {liveItem.titleKo || liveItem.titleEn || liveItem.id} (
              {liveItem.showing ? copy.liveBannerShowing : copy.liveBannerScheduled})
            </p>
          </div>
        ) : null}

        <Panel
          title={copy.listHeading}
          action={
            <span className="admin-field-hint">
              {interpolate(copy.listLimitNote, { limit: String(loaded.limit) })}
            </span>
          }
        >
          <AdminTable
            caption={copy.listHeading}
            empty={copy.listEmpty}
            columns={
              slotsReady
                ? [
                    { key: 'status', label: copy.cols.status },
                    { key: 'slot', label: copy.cols.slot },
                    { key: 'sentence', label: copy.cols.sentence },
                    { key: 'period', label: copy.cols.period },
                    { key: 'shape', label: copy.cols.shape },
                    { key: 'audience', label: copy.cols.audience },
                    { key: 'action', label: copy.cols.action },
                  ]
                : [
                    { key: 'status', label: copy.cols.status },
                    { key: 'sentence', label: copy.cols.sentence },
                    { key: 'period', label: copy.cols.period },
                    { key: 'shape', label: copy.cols.shape },
                    { key: 'audience', label: copy.cols.audience },
                    { key: 'action', label: copy.cols.action },
                  ]
            }
            rows={items.map((item) => ({
              key: item.id,
              data: {
                'data-brand-news-row': item.id,
                'data-status': item.status,
                ...(slotsReady ? { 'data-slot': item.slot } : {}),
              },
              cells: {
                status: (
                  <StatusPill tone={statusTone(item)}>{statusLabel(item, copy.statuses)}</StatusPill>
                ),
                ...(slotsReady ? { slot: copy.slots[item.slot].short } : {}),
                sentence: item.titleKo || item.titleEn || '—',
                period: formatKstPeriod(item.startsAt, item.endsAt),
                shape: copy.shapes[item.shape],
                audience: slotsReady
                  ? describeBrandNewsAudience(item.audience, copy, item.slot)
                  : describeBrandNewsAudience(item.audience, copy),
                action: (
                  <a
                    href={`/admin/brand-news?edit=${item.id}`}
                    className="admin-btn"
                    data-brand-news-open={item.id}
                  >
                    {item.status === 'draft' ? copy.actions.edit : copy.actions.open}
                  </a>
                ),
              },
            }))}
          />
        </Panel>

        <BrandNewsEditor
          key={`${selected?.id ?? 'new'}-${selected?.updatedAt ?? ''}`}
          selected={selected}
          liveItem={liveForEditor}
          initialValues={initialValues}
          nowMs={now.getTime()}
          reach={editorReach}
          studioV2Enabled={brandStudioV2Open()}
          slotsReady={slotsReady}
          roomsOpen={brandRoomsOpen()}
          outcome={outcome}
          copy={copy}
          homeCopyKo={homeCopyKo}
          homeCopyEn={homeCopyEn}
        />
      </div>
    </AdminShell>
  );
}
