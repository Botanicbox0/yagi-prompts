import { brandContext } from "@/components/brand-workspace/context";
import { FundingReturn } from "@/components/campaigns/funding-actions";
export const dynamic = "force-dynamic";
export default async function FundingReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { locale }] = await Promise.all([params, brandContext()]);
  return (
    <section className="mx-auto max-w-3xl px-5 py-10">
      <FundingReturn projectId={id} locale={locale} />
    </section>
  );
}
