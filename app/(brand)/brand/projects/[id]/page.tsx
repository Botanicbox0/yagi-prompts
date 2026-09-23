import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { loadBrandProject } from "@/lib/brands/workspace/service";
import { adminProjectHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandProject({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { sql, viewer, verifiedEmail, brandHost, b, locale }] = await Promise.all([
    params,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const project = await loadBrandProject({ sql, verifiedEmail }, viewer, id);
  if (!project) notFound();
  // `studio` here is the TWINGS team's read-only view (never the customer's seat): no approve, upload or comment.
  return <ProjectDetail project={project} b={b} locale={locale} staffManageHref={project.role === "studio" && viewer.isAdmin ? adminProjectHref(project.id, brandHost) : null} />;
}
