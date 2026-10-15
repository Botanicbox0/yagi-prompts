import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { AppHeader } from "@/components/app/app-header";
import { signInHref } from "@/lib/billing/links";
import { loadParticipation } from "@/lib/campaigns/collaboration/service";
import { ParticipantDetail } from "@/components/campaigns/participant-detail";
export const dynamic = "force-dynamic";
export default async function ParticipationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer, sql, locale] = await Promise.all([
    params,
    getViewer(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const path = `/campaigns/participations/${id}`;
  if (!viewer.userId) redirect(signInHref(path, locale));
  if (!sql) notFound();
  const p = await loadParticipation({ sql }, viewer, id);
  if (!p || p.role !== "creator") notFound();
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={getDictionary(locale)} rest={path} />
      <main id="main">
        <ParticipantDetail participation={p} locale={locale} />
      </main>
    </div>
  );
}
