import type { Dictionary } from "@/lib/i18n/dictionaries";

type Copy = Dictionary["brandWorkspace"];
/**
 * What an invitation that could not be accepted tells the person, by the service's code.
 *
 *   · `not_found`: unknown, expired, revoked, or already used by someone else.
 *   · `existing_member_role_mismatch`: already an active member with a different role. Nothing
 *     changed; only the studio or an owner can change access, so the copy says who to ask.
 *   · `forbidden`: signed in with another address, or one the auth server has not confirmed. Only
 *     another account can fix that, so the page offers sign-out. The token lived in the link's
 *     fragment and is gone after sign-in, so the copy asks them to open the link again.
 */
export function invitationFailure(code: unknown, b: Copy): { notice: string; switchAccount: boolean } {
  if (code === "forbidden") return { notice: b.inviteWrongAccount, switchAccount: true };
  if (code === "not_found" || code === "invalid") return { notice: b.inviteInvalid, switchAccount: false };
  if (code === "existing_member_role_mismatch") return { notice: b.inviteRoleMismatch, switchAccount: false };
  if (code === "rate_limited") return { notice: b.errors.rateLimited, switchAccount: false };
  if (code === "sign_in_required") return { notice: b.denied, switchAccount: false };
  return { notice: b.error, switchAccount: false };
}
