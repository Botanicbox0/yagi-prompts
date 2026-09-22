"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BrandOrganization } from "@/lib/brands/workspace/types";
import { ActionForm, type BrandCopy } from "./action-form";

/** A structured brief in the existing private brand support thread, not a campaign or contract. */
export function StudioInquiry({ organizations, organizationId, b }: {
  organizations: BrandOrganization[]; organizationId?: string; b: BrandCopy;
}) {
  const t = b.studioInquiry;
  const writable = organizations.filter(o => o.role !== "viewer");
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const sending = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setReady(true), []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const data = new FormData(event.currentTarget);
    const fields = ["brief", "references", "volume", "schedule", "budget"] as const;
    const body = [t.messageTitle, ...fields.flatMap(key => {
      const value = String(data.get(key) ?? "").trim();
      return value ? [`${t[key]}\n${value}`] : [];
    })].join("\n\n");
    const input = { organizationId: String(data.get("organizationId") ?? ""), body };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, id: crypto.randomUUID() };
    sending.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "support.send", input: { ...input, requestId: attempt.current.id } }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(["forbidden", "not_found", "sign_in_required"].includes(result.code) ? b.denied : b.error);
        return;
      }
      setSent(true);
    } catch { setError(b.error); }
    finally { sending.current = false; setBusy(false); }
  }

  return <>
    <button type="button" className="bw-button bw-primary" disabled={!ready}
      onClick={() => dialog.current?.showModal()}>{t.action}</button>
    <dialog ref={dialog} className="bw-studio-inquiry" aria-labelledby="studio-inquiry-title" data-studio-inquiry onClose={() => { if (sent) { setSent(false); attempt.current = null; } }}>
      <header>
        <h2 id="studio-inquiry-title">{sent ? t.sent : t.title}</h2>
        <button type="button" className="bw-button" onClick={() => dialog.current?.close()}>{t.close}</button>
      </header>
      {sent ? <p role="status">{t.sentHint}</p> : !organizations.length ? <>
        <p>{t.setup}</p>
        <ActionForm operation="organization.create" b={b} submit={b.createOrganization} redirectTo="/brand/studio">
          <label>{b.organization}<input name="name" minLength={2} maxLength={100} required autoComplete="organization" /></label>
        </ActionForm>
      </> : !writable.length ? <p>{t.readOnly}</p> : <>
        <p>{t.intro}</p>
        <form className="bw-form" onSubmit={send} aria-busy={busy}>
          <fieldset disabled={!ready || busy}>
            <label>{b.organization}<select name="organizationId" defaultValue={writable.find(o => o.id === organizationId)?.id ?? writable[0]?.id ?? ""}>
              {writable.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
            <label>{t.brief}<textarea name="brief" required minLength={5} maxLength={1600} rows={4} placeholder={t.briefHint} /></label>
            <label>{t.references}<textarea name="references" maxLength={700} rows={2} placeholder={t.referenceHint} /></label>
            <label>{t.volume}<input name="volume" maxLength={160} placeholder={t.volumeHint} /></label>
            <div className="bw-studio-inquiry-pair">
              <label>{t.schedule}<input name="schedule" maxLength={120} /></label>
              <label>{t.budget}<input name="budget" maxLength={120} placeholder={t.budgetHint} /></label>
            </div>
          </fieldset>
          <p className="bw-muted">{t.terms}</p>
          {error && <p role="alert" className="bw-error">{error}</p>}
          <button type="submit" className="bw-button bw-primary" disabled={!ready || busy}>{busy ? b.working : t.submit}</button>
        </form>
      </>}
    </dialog>
  </>;
}
