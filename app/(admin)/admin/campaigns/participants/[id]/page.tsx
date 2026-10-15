import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadParticipation } from "@/lib/campaigns/collaboration/service";
import { ParticipantDetail } from "@/components/campaigns/participant-detail";
import { CollaborationAdminForms } from "@/components/campaigns/collaboration-admin";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
export const dynamic = "force-dynamic";
export default async function AdminParticipant({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, viewer, sql, locale, search] = await Promise.all([
    params,
    getViewer(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    searchParams,
  ]);
  if (!sql) notFound();
  const p = await loadParticipation({ sql }, viewer, id);
  if (!p || p.role !== "studio") notFound();
  const d = getDictionary(locale);
  return (
    <AdminShell active="campaigns" dict={d.admin} locale={locale}>
      <OutcomeBanner
        dict={d.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
      />
      <ParticipantDetail
        participation={p}
        locale={locale}
        adminForms={
          <CollaborationAdminForms applicationId={id} locale={locale} />
        }
      />
    </AdminShell>
  );
}
