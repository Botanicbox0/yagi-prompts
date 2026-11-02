import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CampaignPerformance,ReportResult} from '@/components/brand-workspace/performance';
import {getDictionary} from '@/lib/i18n/dictionaries';
import {UNKNOWN_POST_PRESENTATION} from '@/lib/brands/workspace/performance';
import type {BrandProjectDetail,BrandPost,BrandReport} from '@/lib/brands/workspace/types';
const post:BrandPost={id:'post',origin:'approved_content',contentVersionId:'content',url:'https://www.instagram.com/p/EXAMPLE/',platform:'instagram',publishedAt:'2026-09-01T00:00:00Z',metricRevision:0,verification:'manual',metricsSource:'creator_evidence',measuredAt:'2026-09-02T00:00:00Z',views:1200,viewsApproximate:false,likes:null,comments:3,shares:null,saves:0,createdAt:'2026-09-01T00:00:00Z',presentation:UNKNOWN_POST_PRESENTATION};
const project:BrandProjectDetail={id:'p',organizationId:'o',organizationName:'Example brand',title:'Sample launch',objective:'Example',audience:'',budgetKrw:null,budgetTaxBasis:'unspecified',criteria:{platforms:['instagram'],minFollowers:null,maxFollowers:null,primaryMetric:'views',targetValue:2000},startsOn:null,endsOn:null,productionMode:'creator',status:'active',revision:1,createdAt:'2026-09-01',updatedAt:'2026-09-01',role:'viewer',canComment:false,referenceLinks:[],decisions:[],messages:[],reports:[],posts:[post],contents:[{id:'content',slotKey:'one',version:1,title:'<script>unsafe</script>',attachmentId:'image',mediaUrl:'/api/brand-workspace/attachments/image',caption:'',usageRights:'Example',reviewRevision:1,decision:'approved',createdAt:'2026-09-01'}],attachments:[{id:'image',name:'example.png',mime:'image/png',sizeBytes:4,createdAt:'2026-09-01'}]};
describe('private campaign performance UI',()=>{
 it.each(['ko','en'] as const)('shows ranked content, measured coverage and private previews in %s',locale=>{
  const b=getDictionary(locale).brandWorkspace;const html=renderToStaticMarkup(<CampaignPerformance project={project} b={b} locale={locale}/>);
  expect(html).toContain(b.performance.topViews);expect(html).toContain(b.performance.topEngagement);expect(html).toContain(b.performance.noRanking);
  expect(html).toContain('src="/api/brand-workspace/attachments/image"');expect(html).not.toContain('src="https://www.instagram');expect(html).not.toContain('<script>unsafe');
  expect(html).toContain('1,200');expect(html).toContain(b.performance.unknownNote);expect(html).toContain(b.sourceLabels.creator_evidence);
 });
 it('renders the frozen report figures, never the subsequently updated live figures or target',()=>{
  const report:BrandReport={id:'r',version:1,summary:'An earlier report',periodStart:'2026-09-01',periodEnd:'2026-09-02',createdAt:'2026-09-02',snapshot:{totalPosts:1,measuredPosts:1,viewsTotal:1200,viewsTotalApproximate:false,metricDefinition:'sum_of_latest_post_views',posts:[post]}};
  const b=getDictionary('en').brandWorkspace;const html=renderToStaticMarkup(<ReportResult project={{...project,posts:[{...post,views:987654}]}} report={report} b={b} locale="en"/>);
  expect(html).toContain('1,200');expect(html).not.toContain('987,654');expect(html).not.toContain(b.performance.target);expect(html).toContain(b.performance.reportFrozen);
 });
});
