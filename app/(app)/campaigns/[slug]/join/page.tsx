import { getViewer } from "@/lib/auth/viewer";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { AppHeader } from "@/components/app/app-header";
import { signInHref } from "@/lib/billing/links";
import { JoinForm } from "@/components/campaigns/collaboration-forms";
import { collaborationCopy } from "@/messages/campaign-collaboration";
import { getSqlRunner } from "@/lib/db/connect";
import { InvitationTerms } from "@/components/campaigns/invitation-terms";
import { notFound } from "next/navigation";
import {
  collaborationReady,
  loadInvitationLanding,
} from "@/lib/campaigns/collaboration/service";
export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function CampaignJoin({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, viewer, locale, sql] = await Promise.all([
    params,
    getViewer(),
    getLocaleFromHeaders(),
    getSqlRunner(),
  ]);
  const t = collaborationCopy(locale),
    path = `/campaigns/${encodeURIComponent(slug)}/join`,
    dict = getDictionary(locale);
  if (!sql || !(await collaborationReady(sql)))
    return (
      <main id="main" className="mx-auto max-w-xl px-5 py-16">
        <p>{t.unavailable}</p>
      </main>
    );
  // One SELECT supplies both the visible terms and their hash. Acceptance rechecks it.
  const landing = await loadInvitationLanding(sql, slug);
  if (!landing) notFound();
  const { campaign: c, version } = landing;
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={path} />
      <main id="main" className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-3xl font-semibold">{t.join}</h1>
        <p className="my-6 text-sm leading-relaxed opacity-70">{t.joinIntro}</p>
        <InvitationTerms campaign={c} locale={locale} dict={dict} />
        <JoinForm
          locale={locale}
          slug={slug}
          signedIn={!!viewer.userId}
          termsVersion={version}
          signInHref={signInHref(path, locale)}
        />
      </main>
    </div>
  );
}
