import {notFound} from 'next/navigation';
import {brandContext} from '@/components/brand-workspace/context';
import {loadBrandProject} from '@/lib/brands/workspace/service';
import {ReportResult} from '@/components/brand-workspace/performance';
export const dynamic='force-dynamic';
export default async function BrandReportPage({params}:{params:Promise<{id:string;reportId:string}>}){
 const {id,reportId}=await params;const {sql,viewer,b,locale}=await brandContext();
 if(!sql)return <p role="alert">{b.unavailable}</p>;
 const project=await loadBrandProject({sql},viewer,id),report=project?.reports.find(r=>r.id===reportId);
 if(!project||!report)notFound();
 return <><a className="bw-no-print bw-button" href={`/brand/projects/${id}`}>← {b.back}</a><ReportResult project={project} report={report} b={b} locale={locale}/></>;
}
