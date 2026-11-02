"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { POOL_API } from "@/lib/brands/creator-pool";
import type { BrandCopy } from "./action-form";

export interface InviteCampaign { id: string; title: string; meta: string; full: boolean }
type Copy = BrandCopy["creatorPool"];
type ErrorCode = keyof Copy["errors"];

/**
 * "Invite to a campaign" (docs/PLATFORM-2.0.md §17.3): a modal list of this brand's recruiting
 * campaigns. A campaign the person is already named in, or one at its invitation cap, cannot be
 * picked. One request id per chosen campaign, so a double submit or a retry stays one invitation.
 */
export function CreatorInvite({ card, campaigns, copy }: { card: { id: string; handle: string; invitedTo: string[] }; campaigns: InviteCampaign[]; copy: Copy }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const requests = useRef(new Map<string, string>());
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "sent" | "error"; text: string } | null>(null);
  const available = campaigns.filter((c) => !c.full && !card.invitedTo.includes(c.id));
  const title = copy.dialogTitle.replace("{handle}", card.handle);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const campaignId = String(new FormData(event.currentTarget).get("campaignId") ?? "");
    if (!campaignId) return;
    const requestId = requests.current.get(campaignId) ?? crypto.randomUUID();
    requests.current.set(campaignId, requestId);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(POOL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, socialAccountId: card.id, requestId }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (result.ok || result.code === "invitation_retry") {
        setMessage({ kind: "sent", text: copy.sent });
        router.refresh();
        return;
      }
      const code = result.code as ErrorCode | undefined;
      // A refusal is final for this request id; a new attempt gets a new one.
      requests.current.delete(campaignId);
      setMessage({ kind: "error", text: (code && copy.errors[code]) || copy.errors.failed });
    } catch {
      setMessage({ kind: "error", text: copy.errors.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="bw-button" data-creator-invite={card.id} onClick={() => { setMessage(null); dialog.current?.showModal(); }}>
        {copy.invite}
      </button>
      <dialog ref={dialog} className="bw-invite-dialog" aria-labelledby={titleId} data-creator-invite-dialog>
        <form onSubmit={submit}>
          <header>
            <strong id={titleId} translate="no">{title}</strong>
            <button type="button" className="bw-invite-close" onClick={() => dialog.current?.close()} aria-label={copy.close}>×</button>
          </header>
          <p className="bw-muted">{copy.dialogIntro}</p>
          <fieldset className="bw-invite-options" disabled={busy}>
            <legend className="sr-only">{copy.invite}</legend>
            {campaigns.map((c) => {
              const invited = card.invitedTo.includes(c.id);
              const blocked = invited || c.full;
              return (
                <label key={c.id} data-invite-option={c.id} data-invite-blocked={blocked || undefined}>
                  <input type="radio" name="campaignId" value={c.id} disabled={blocked} required defaultChecked={!blocked && c.id === available[0]?.id} />
                  <span>
                    <strong>{c.title}</strong>
                    <small>{c.meta}</small>
                    {blocked && <em>{invited ? copy.alreadyInvited : copy.full}</em>}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p role="status" aria-live="polite" className="bw-invite-status" data-invite-status={message?.kind}>{message?.text}</p>
          <footer>
            <button type="button" className="bw-button bw-invite-cancel" onClick={() => dialog.current?.close()}>{copy.close}</button>
            <button type="submit" className="bw-button bw-primary" disabled={busy || !available.length || message?.kind === "sent"}>{busy ? copy.sending : copy.send}</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
