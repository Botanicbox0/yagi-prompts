"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BrandOrganization } from "@/lib/brands/workspace/types";
import { ActionForm, type BrandCopy } from "./action-form";

/** A structured brief in the existing private brand support thread, not a campaign or contract. */
export function StudioInquiry({ organizations, organizationId, b, allowSetup = false, label, primary = true }: {
  organizations: BrandOrganization[]; organizationId?: string; b: BrandCopy;
  /** Only a brand-new account (no workspace, no shared campaigns) may create a workspace from here. */
  allowSetup?: boolean;
  /** The opening button's text; defaults to the first-request label. */
  label?: string;
  /** Secondary once templates exist: creating videos is then the page's main action. */
  primary?: boolean;
}) {
  const t = b.studioInquiry;
  const router = useRouter();
  const writable = organizations.filter(o => o.role !== "viewer");
  // Viewers and campaign-only invitees cannot send a request; the page explains that instead.
  const available = writable.length > 0 || (organizations.length === 0 && allowSetup);
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

  if (!available) return null;
  return <>
    <button type="button" className={primary ? "bw-button bw-primary" : "bw-button"} disabled={!ready}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>{label ?? t.action}</button>
    {/* After a sent request, refresh so the page shows the request as received. */}
    <dialog ref={dialog} className="bw-studio-inquiry" aria-labelledby="studio-inquiry-title" data-studio-inquiry onClose={() => { if (sent) { setSent(false); attempt.current = null; router.refresh(); } }}>
      <header>
        <h2 id="studio-inquiry-title">{sent ? t.sent : t.title}</h2>
        <button type="button" className="bw-button" onClick={() => dialog.current?.close()}>{t.close}</button>
      </header>
      {sent ? <p role="status">{t.sentHint}</p> : !writable.length ? <>
        <p>{t.setup}</p>
        <ActionForm operation="organization.create" b={b} submit={b.createOrganization} redirectTo="/brand/studio">
          <label>{b.organization}<input name="name" minLength={2} maxLength={100} required autoComplete="organization" /></label>
        </ActionForm>
      </> : <>
        <p>{t.intro}</p>
        <p className="bw-note">
          <a
            href={`/brand/projects/new?track=template_build${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ""}`}
            data-template-track-shortcut
          >
            에셋 폴더 · Frame.io 타임코드 시사 룸과 함께 전용 템플릿 의뢰하기 →
          </a>
        </p>
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
