import { getViewer } from "@/lib/auth/viewer";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { AcceptInvitation } from "@/components/brand-workspace/invite";
export default async function InvitationPage() {
  const [viewer, locale] = await Promise.all([getViewer(), getRequestLocale()]);
  const b = getDictionary(locale).brandWorkspace;
  return (
    <section className="bw-panel bw-sota-invite-landing" data-brand-invitation>
      <span className="bw-kicker">{b.title}</span>
      <div className="bw-heading">
        <h1>{b.inviteTitle}</h1>
      </div>
      <AcceptInvitation signedIn={viewer.userId !== null} b={b} />
    </section>
  );
}
