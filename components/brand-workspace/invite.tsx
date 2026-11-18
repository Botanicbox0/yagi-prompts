"use client";
import { useEffect, useState } from "react";
import { ActionForm, type BrandCopy } from "./action-form";
import { PENDING_BRAND_INVITATION_KEY as KEY } from "@/lib/auth/invitation-transfer";
export function AcceptInvitation({
  signedIn,
  b,
  note,
  loginNote,
}: {
  signedIn: boolean;
  b: BrandCopy;
  /**
   * With room invitations on (docs/BRAND-ROOMS-FEEDBACK.md §12) a project invitation binds to the account
   * that accepts it, so the line under the button says that instead of the e-mail-only rule.
   */
  note?: string;
  /** Before sign-in, with room invitations on: a line true for both kinds (the page cannot tell them apart yet). */
  loginNote?: string;
}) {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(location.origin);
    const incoming = new URLSearchParams(location.hash.slice(1)).get("token");
    // Tokens never travel in query strings, OAuth return paths, analytics or server-rendered props.
    if (location.hash) history.replaceState(null, "", location.pathname);
    try {
      if (incoming && /^[A-Za-z0-9_-]{43}$/.test(incoming)) {
        sessionStorage.setItem(
          KEY,
          JSON.stringify({
            token: incoming,
            expiresAt: Date.now() + 30 * 60 * 1000,
          }),
        );
        setToken(incoming);
      } else {
        const pending = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
        if (
          pending?.expiresAt > Date.now() &&
          /^[A-Za-z0-9_-]{43}$/.test(pending.token)
        )
          setToken(pending.token);
        else sessionStorage.removeItem(KEY);
      }
    } catch {
      if (incoming && /^[A-Za-z0-9_-]{43}$/.test(incoming)) setToken(incoming);
    }
    setReady(true);
  }, []);
  if (!ready) return <p role="status">{b.loading}</p>;
  if (!token) return <p role="alert">{b.inviteInvalid}</p>;
  if (!signedIn)
    return (
      <>
        <p className="bw-note" data-invite-login>{loginNote ?? b.inviteLogin}</p>
        <a
          className="bw-button bw-primary"
          href="/auth/choose?next=%2Fbrand%2Finvite"
        >
          {b.inviteSignIn}
        </a>
        <details className="bw-note">
          <summary>{b.inviteOtherBrowser}</summary>
          <p>{b.inviteBrowserHint}</p>
          <label>
            {b.inviteToken}
            <input
              readOnly
              value={`${origin}/brand/invite#token=${encodeURIComponent(token)}`}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </details>
      </>
    );
  return (
    <ActionForm
      operation="invitation.accept"
      fixed={{ token }}
      b={b}
      submit={b.acceptInvite}
    >
      <p className="bw-note" data-invite-note>{note ?? b.inviteExpiry}</p>
    </ActionForm>
  );
}
