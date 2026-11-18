import { getViewer } from "@/lib/auth/viewer";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { AcceptInvitation } from "@/components/brand-workspace/invite";
import { brandRoomInvitesOpen } from "@/lib/flags";
export default async function InvitationPage() {
  const [viewer, locale] = await Promise.all([getViewer(), getRequestLocale()]);
  const dict = getDictionary(locale);
  const b = dict.brandWorkspace;
  // docs/BRAND-ROOMS-FEEDBACK.md §12: the token stays in the address fragment until sign-in, so this page cannot
  // tell a project invitation from a workspace one; with invitations on, both lines are true for both kinds.
  const invitesOn = brandRoomInvitesOpen();
  return (
    <section className="bw-panel bw-sota-invite-landing" data-brand-invitation>
      <span className="bw-kicker">{b.title}</span>
      <div className="bw-heading">
        <h1>{b.inviteTitle}</h1>
      </div>
      <AcceptInvitation signedIn={viewer.userId !== null} b={b} note={invitesOn ? dict.roomsShare.accept.note : undefined} loginNote={invitesOn ? dict.roomsShare.accept.login : undefined} />
    </section>
  );
}
