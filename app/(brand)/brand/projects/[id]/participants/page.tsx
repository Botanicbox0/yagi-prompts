import { notFound } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { loadProjectCollaboration } from "@/lib/campaigns/collaboration/service";
import {
  InvitationForm,
  CollaborationForm,
} from "@/components/campaigns/collaboration-forms";
import { collaborationCopy } from "@/messages/campaign-collaboration";
import { formatCampaignDateTime } from "@/lib/campaigns/dates";
export const dynamic = "force-dynamic";
export default async function BrandParticipants({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { sql, viewer, locale }] = await Promise.all([
    params,
    brandContext(),
  ]);
  const t = collaborationCopy(locale);
  if (!sql) return <p>{t.unavailable}</p>;
  const state = await loadProjectCollaboration({ sql }, viewer, id);
  if (!state) notFound();
  return (
    <section className="mx-auto max-w-5xl px-5 py-10" data-brand-participants>
      <a
        href={`/brand/projects/${id}`}
        className="text-sm text-accent underline"
      >
        ← {t.back}
      </a>
      <h1 className="mt-5 text-3xl font-semibold">{t.title}</h1>
      <p className="mt-3 text-sm opacity-70">{t.intro}</p>
      {!state.campaigns.length && <p className="mt-8">{t.unavailable}</p>}
      {state.campaigns.map((c) => (
        <section
          key={c.id}
          className="mt-10 rounded-2xl border border-hairline p-5 sm:p-8"
        >
          <h2 className="text-xl font-semibold">
            {locale === "en" ? c.title.en : c.title.ko}
          </h2>
          <div className="mt-7 grid gap-10 lg:grid-cols-2">
            <div>
              {state.canInvite && !viewer.isAdmin && (
                <InvitationForm locale={locale} campaignId={c.id} />
              )}
              <h3 className="mt-8 font-semibold">{t.invitations}</h3>
              <ul className="mt-4 space-y-4">
                {c.invitations.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-lg border border-hairline p-3"
                  >
                    <p className="text-sm">
                      {t.states[i.status]} ·{" "}
                      <time dateTime={i.expiresAt}>
                        {formatCampaignDateTime(i.expiresAt, locale)}
                      </time>
                    </p>
                    {i.status === "pending" &&
                      state.canInvite &&
                      !viewer.isAdmin && (
                        <CollaborationForm
                          locale={locale}
                          operation="invitation.revoke"
                          hidden={{ invitationId: i.id }}
                          label={t.revoke}
                        >
                          {null}
                        </CollaborationForm>
                      )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">{t.participants}</h3>
              <ul className="mt-4 space-y-3">
                {c.participants.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-hairline p-4"
                  >
                    <span className="text-sm">
                      {t.states[p.status as keyof typeof t.states]}
                    </span>
                    {p.profileUrl && (
                      <a
                        href={p.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block break-all text-sm text-accent underline"
                      >
                        {p.profileUrl}
                      </a>
                    )}
                    <a
                      href={`/brand/projects/${id}/participants/${p.id}`}
                      className="mt-2 block text-sm text-accent underline"
                    >
                      {t.open}
                    </a>
                  </li>
                ))}
              </ul>
              {!c.participants.length && (
                <p className="mt-4 text-sm opacity-60">{t.none}</p>
              )}
            </div>
          </div>
        </section>
      ))}
    </section>
  );
}
