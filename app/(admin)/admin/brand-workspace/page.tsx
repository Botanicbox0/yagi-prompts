import "@/app/(brand)/workspace.css";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadStudioWorkspace } from "@/lib/brands/workspace/service";
import { AdminShell } from "@/components/admin/chrome";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { WorkspaceLanguage } from '@/components/brand-workspace/language';
export const dynamic = "force-dynamic";
export default async function StudioBrands() {
  const [viewer, sql, locale] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const dict = getDictionary(locale),
    b = dict.brandWorkspace;
  const workspace = sql ? await loadStudioWorkspace({ sql }, viewer) : null;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <div data-studio-brand-queue>
        <div className="bw-heading">
          <div><h1>{b.studioTitle}</h1><p>{b.performance.queueHint}</p></div>
          <WorkspaceLanguage locale={locale} label={dict.nav.localeToggle}/>
        </div>
        {!workspace ? (
          <p role="alert">{b.unavailable}</p>
        ) : !workspace.projects.length ? (
          <div className="bw-empty">{b.studioEmpty}</div>
        ) : (
          <section className="bw-panel">
            <CampaignList projects={workspace.projects} b={b} locale={locale} studio/>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
