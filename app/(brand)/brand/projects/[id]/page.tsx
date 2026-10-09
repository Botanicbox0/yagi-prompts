import { campaignListReturnPath } from "@/lib/brands/workspace/navigation";
import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { loadBrandProject } from "@/lib/brands/workspace/service";
import { loadBrandUsage } from "@/lib/brands/usage/service";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import { adminProjectHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { sql, viewer, verifiedEmail, brandHost, b, locale }, search] = await Promise.all([
    params,
    brandContext(),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const project = await loadBrandProject({ sql, verifiedEmail }, viewer, id);
  if (!project) notFound();
  // Secondary usage is the brand's commercial matter: null (no tab) for campaign-only guests.
  const usage = await loadBrandUsage({ sql, verifiedEmail, paymentsOpen: usagePaymentsOpen() }, viewer, id);
  // `studio` here is the TWINGS team's read-only view (never the customer's seat): no approve, upload or comment.
  return <ProjectDetail backHref={campaignListReturnPath(search.returnTo, project.organizationId)} project={project} b={b} locale={locale} usage={usage} staffManageHref={project.role === "studio" && viewer.isAdmin ? adminProjectHref(project.id, brandHost) : null} />;
}
