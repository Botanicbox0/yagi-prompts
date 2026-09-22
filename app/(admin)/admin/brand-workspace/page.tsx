import { ManagedForm } from '@/components/brand-workspace/managed-form';
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
          <div><h1>{b.dashboard.studioTitle}</h1><p>{b.dashboard.studioSubtitle}</p></div>
          <WorkspaceLanguage locale={locale} label={dict.nav.localeToggle}/>
        </div>
        {workspace&&<section className="bw-panel" data-managed-brands><div className="bw-section-heading"><h2>{b.managed.manageTitle}</h2></div><p className="bw-muted">{b.managed.manageHint}</p><div className="bw-grid">
          <details className="bw-contract-add"><summary>{b.managed.createBrand}</summary><ManagedForm op="brandWorkspace.organization" b={b} submit={b.managed.createBrand}><label>{b.organization}<input name="name" minLength={2} maxLength={100} required/></label></ManagedForm></details>
          {workspace.organizations.length>0&&<details className="bw-contract-add"><summary>{b.managed.createCampaign}</summary><ManagedForm op="brandWorkspace.createProject" b={b} submit={b.managed.createCampaign}>
            <label>{b.organization}<select name="organizationId">{workspace.organizations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
            <label>{b.projectTitle}<input name="title" minLength={3} maxLength={120} required/></label>
            <label>{b.objective}<textarea name="objective" minLength={3} maxLength={2000} required/></label>
            <label>{b.budget}<input type="number" name="budgetKrw" min={0}/></label><input type="hidden" name="productionMode" value="creator"/>
          </ManagedForm></details>}
        </div><ul className="bw-brand-list">{workspace.organizations.map(o=><li key={o.id}><a href={`/admin/brand-workspace/organizations/${o.id}`}><span className="bw-brand-avatar">{o.name.slice(0,1)}</span><strong>{o.name}</strong><span>{b.managed.access} ↗</span></a></li>)}</ul></section>}
        {!workspace ? (
          <p role="alert">{b.unavailable}</p>
        ) : !workspace.projects.length ? (
          <div className="bw-empty">{b.studioEmpty}</div>
        ) : (
          <CampaignList projects={workspace.projects} b={b} locale={locale} studio/>
        )}
      </div>
    </AdminShell>
  );
}
