import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { loadParticipation } from "@/lib/campaigns/collaboration/service";
import { ParticipantDetail } from "@/components/campaigns/participant-detail";
export const dynamic = "force-dynamic";
export default async function BrandParticipant({
  params,
}: {
  params: Promise<{ id: string; applicationId: string }>;
}) {
  const [{ id, applicationId }, { sql, viewer, locale }] = await Promise.all([
    params,
    brandContext(),
  ]);
  if (!sql) notFound();
  const p = await loadParticipation({ sql }, viewer, applicationId);
  if (!p || p.projectId !== id || p.role !== "brand") notFound();
  return <ParticipantDetail participation={p} locale={locale} />;
}
