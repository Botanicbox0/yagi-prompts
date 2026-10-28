import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { publicHref, requestSurface } from '@/lib/routing/request-surface';
import { LANDING_MEDIA_SLOTS, type LandingMediaGroup, type LandingMediaPage } from '@/lib/content/landing-media';
import { landingMediaMap, landingMediaTableExists, loadLandingMediaRows } from '@/lib/content/landing-media-repo';
import { AdminShell } from '@/components/admin/chrome';
import { LandingMediaEditor, type EditorPage } from '@/components/admin/landing-media-editor';

/**
 * `/admin/landing-media` — the founder replaces landing images without a deploy (2026-10-29,
 * "wix처럼"). Tiles follow the landing's own order; every save goes through `/admin/do`
 * (`landingMedia.replace` / `landingMedia.reset`) and refreshes the landing caches.
 */
export const dynamic = 'force-dynamic';

const PAGES: readonly LandingMediaPage[] = ['brands', 'home'];

export default async function AdminLandingMediaPage() {
  await requireAdmin();
  const [locale, sql, surface] = await Promise.all([getLocaleFromHeaders(), getSqlRunner(), requestSurface()]);
  const dict = getDictionary(locale);
  const copy = dict.landingMedia;
  const ready = sql !== null && (await landingMediaTableExists(sql));
  const rows = ready ? await loadLandingMediaRows(sql!) : [];
  const overrides = landingMediaMap(rows);
  // Default files live on twings.app; the admin host serves no /reel/* bytes.
  const asset = (path: string) => (path.startsWith('/') ? publicHref(path, surface.admin) : path);

  const pages: EditorPage[] = PAGES.map((page) => {
    const groups = new Map<LandingMediaGroup, EditorPage['groups'][number]>();
    for (const slot of LANDING_MEDIA_SLOTS.filter((candidate) => candidate.page === page)) {
      const group = groups.get(slot.group) ?? { id: slot.group, title: copy.groups[slot.group], slots: [] };
      group.slots.push({
        key: slot.key,
        name: slot.key.split('/')[1]!,
        ratio: slot.ratio,
        width: slot.width,
        alpha: slot.alpha === true,
        defaultSrc: asset(slot.src),
        currentSrc: asset(overrides[slot.key] ?? slot.src),
        replaced: slot.key in overrides,
      });
      groups.set(slot.group, group);
    }
    return { id: page, title: copy.pages[page], href: publicHref(page === 'brands' ? `/${locale}/brands` : `/${locale}`, surface.admin), groups: [...groups.values()] };
  });

  return (
    <AdminShell dict={dict.admin} locale={locale} active="landingMedia">
      <p className="text-accent font-label text-eyebrow uppercase">{copy.nav}</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">{copy.heading}</h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{copy.lede}</p>
      <p className="mt-2 max-w-detail font-mono text-code opacity-50">{copy.sizeNote}</p>
      {!ready && (
        <p data-landing-media-unavailable className="mt-6 border border-accent px-4 py-3 font-mono text-code text-accent">
          {sql === null ? copy.noDatabase : copy.migration}
        </p>
      )}
      <LandingMediaEditor pages={pages} copy={copy} disabled={!ready} />
    </AdminShell>
  );
}
