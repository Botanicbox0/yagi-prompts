import { notFound, redirect } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { ProductionResult } from "@/components/brand-workspace/production-result";
import { loadProductionOutput } from "@/lib/brands/production/service";
export default async function BrandProductionResult({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ id }, { organizationId }, { sql, viewer, b, locale }] = await Promise.all([
    params,
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p>{b.unavailable}</p>;
  const job = await loadProductionOutput({ sql }, viewer, id);
  if (!job) notFound();
  // The result belongs to one brand; the URL (and so the sidebar selector) always names that brand.
  if (organizationId !== job.organizationId)
    redirect(`/brand/studio/${encodeURIComponent(id)}?organizationId=${job.organizationId}&locale=${locale}`);
  return (
    <div>
      <div className="bw-heading">
        <div>
          <a
            href={`/brand/studio?organizationId=${job.organizationId}&locale=${locale}`}
          >
            ← {b.productionStudio.title}
          </a>
          <h1>{locale === "ko" ? job.titleKo : job.title}</h1>
        </div>
      </div>
      <ProductionResult
        id={id}
        initialStatus={job.status}
        released={job.released}
        t={b.productionStudio}
      />
    </div>
  );
}
