import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { loadBrandProject } from "@/lib/brands/workspace/service";
export default async function BrandProject({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { sql, viewer, b, locale }] = await Promise.all([
    params,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const project = await loadBrandProject({ sql }, viewer, id);
  if (!project) notFound();
  return <ProjectDetail project={project} b={b} locale={locale} />;
}
