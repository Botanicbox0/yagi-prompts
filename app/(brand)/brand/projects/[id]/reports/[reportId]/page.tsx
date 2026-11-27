import {notFound} from 'next/navigation';
import {brandContext} from '@/components/brand-workspace/context';
import {loadBrandProject} from '@/lib/brands/workspace/service';
import {loadFeaturePolicy} from '@/lib/brands/entitlements';
import {ReportResult} from '@/components/brand-workspace/performance';
import {roomTrack} from '@/lib/brand-rooms/overview';
import {brandCampaignOpsOpenFor, brandRoomsOpen, brandStudioV2Open} from '@/lib/flags';
import {campaignOpsOpenForViewer} from '@/lib/brands/workspace/campaign-ops';
import {CampaignOpsTrackMarker} from '@/components/brand-workspace/campaign-ops/track-context';
export const dynamic='force-dynamic';
export default async function BrandReportPage({params}:{params:Promise<{id:string;reportId:string}>}){
 const {id,reportId}=await params;const {sql,viewer,verifiedEmail,b,locale}=await brandContext();
 if(!sql)return <p role="alert">{b.unavailable}</p>;
 const project=await loadBrandProject({sql,verifiedEmail},viewer,id),report=project?.reports.find(r=>r.id===reportId);
 if(!project||!report)notFound();
 let opsOpen=false;
 if(brandStudioV2Open()&&brandRoomsOpen()&&brandCampaignOpsOpenFor(project.organizationId)){
  const policy=await loadFeaturePolicy(sql,project.organizationId).catch(()=>({denied:[] as const}));
  opsOpen=campaignOpsOpenForViewer({id:project.organizationId,name:project.organizationName,role:project.role,denied:policy.denied});
 }
 if(!opsOpen)return <><a className="bw-no-print bw-button" href={`/brand/projects/${id}`}>← {b.back}</a><ReportResult project={project} report={report} b={b} locale={locale}/></>;
 return <><CampaignOpsTrackMarker track={roomTrack(project)}/><a className="bw-no-print bw-button" href={`/brand/projects/${id}`}>← {b.back}</a><ReportResult project={project} report={report} b={b} locale={locale}/></>;
}
