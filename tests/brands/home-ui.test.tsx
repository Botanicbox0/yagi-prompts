import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignList } from '@/components/brand-workspace/campaign-list';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { BrandProjectSummary } from '@/lib/brands/workspace/types';
const p: BrandProjectSummary = { id:'project', organizationId:'org', organizationName:'Sample', title:'Launch', objective:'', audience:'', budgetKrw:null, budgetTaxBasis:'unspecified', criteria:{platforms:['instagram'], minFollowers:null,maxFollowers:null,primaryMetric:'views',targetValue:null}, startsOn:null, endsOn:null, productionMode:'studio', status:'active', revision:1, createdAt:'2026-09-01',updatedAt:'2026-09-01', overview:{pending:1, changes:0,published:0,contents:[{id:'content', title:'Review this', version:2, decision:'pending', mime:'image/jpeg',mediaUrl:'/api/brand-workspace/attachments/protected',createdAt:'2026-09-01'}]} };
describe('campaign workspace home',()=>{
  it.each(['ko','en'] as const)('links pending reviews and protected previews in %s', locale=>{
    const b=getDictionary(locale).brandWorkspace;
    const html=renderToStaticMarkup(<CampaignList projects={[p]} b={b} locale={locale}/>);
    expect(html).toContain('data-home-attention');
    expect(html).toContain('href="/brand/projects/project#review"');
    expect(html).toContain('src="/api/brand-workspace/attachments/protected"');
    expect(html).toContain(b.dashboard.recent);
    expect(html).not.toContain('/admin/');
  });
  it('never asks for approval on closed campaigns even if an old version is pending',()=>{
    const html=renderToStaticMarkup(<CampaignList projects={[{...p,status:'completed'}]} b={getDictionary('en').brandWorkspace} locale="en"/>);
    expect(html).not.toContain('data-home-attention');
  });
  it('routes studio requests to operations and presents missing media without stock imagery',()=>{
    const b=getDictionary('en').brandWorkspace;
    const html=renderToStaticMarkup(<CampaignList projects={[{...p,status:'requested',overview:undefined}]} b={b} locale="en" studio/>);
    expect(html).toContain('href="/admin/brand-workspace/project"');
    expect(html).toContain(b.dashboard.openRequest);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data-home-recent');
  });
});
