import '@/app/(brand)/workspace.css';
import {notFound} from 'next/navigation';
import {requireAdmin} from '@/lib/auth/viewer';
import {getSqlRunner} from '@/lib/db/connect';
import {getLocaleFromHeaders} from '@/lib/i18n/server';
import {getDictionary} from '@/lib/i18n/dictionaries';
import {loadStudioProject} from '@/lib/brands/workspace/service';
import {ReportResult} from '@/components/brand-workspace/performance';
import {AdminShell} from '@/components/admin/chrome';
export const dynamic='force-dynamic';
export default async function StudioReportPage({params}:{params:Promise<{id:string;reportId:string}>}){
 const [{id,reportId},viewer,sql,locale]=await Promise.all([params,requireAdmin(),getSqlRunner(),getLocaleFromHeaders()]);
 const dict=getDictionary(locale),b=dict.brandWorkspace;
 if(!sql)return <p role="alert">{b.unavailable}</p>;
 const project=await loadStudioProject({sql},viewer,id),report=project?.reports.find(r=>r.id===reportId);
 if(!project||!report)notFound();
 return <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace"><a className="bw-no-print bw-button" href={`/admin/brand-workspace/${id}`}>← {b.back}</a><ReportResult project={project} report={report} b={b} locale={locale}/></AdminShell>;
}
