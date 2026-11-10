"use client";
/**
 * "공유" for one draft or one storyboard (docs/BRAND-ROOMS.md §6): a dialog that makes a link for someone
 * outside the workspace (notes on/off, download on/off, how long it works, an optional passphrase), shows
 * the new address once to copy, and lists the links already made with their views, expiry and a switch
 * to turn each off. Owners and editors only; for anyone else the button is not there.
 */
import "./share.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SHARE_EXPIRY_CHOICES, SHARE_LIMITS, sharePath, type ShareLink } from "@/lib/brand-rooms/share-contracts";
import type { ShareButtonProps } from "../seams";
import { createShareLink, fetchShares, revokeShareLink } from "../review/api";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

const DATE = new Map<string, Intl.DateTimeFormat>();
function day(iso: string, locale: "ko" | "en"): string {
  let f = DATE.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" });
    DATE.set(locale, f);
  }
  return f.format(new Date(iso));
}

export function ShareButton({ organizationId, target, locale, copy, canEdit }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <button type="button" className="brh-open" onClick={() => setOpen(true)} data-share-open={target.kind} aria-haspopup="dialog">
        <svg className="brh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
        </svg>
        {copy.share.open}
      </button>
      {open && <ShareDialog organizationId={organizationId} target={target} locale={locale} copy={copy} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ organizationId, target, locale, copy, onClose }: Omit<ShareButtonProps, "canEdit"> & { onClose(): void }) {
  const s = copy.share;
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [allowComments, setAllowComments] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [days, setDays] = useState<number>(SHARE_LIMITS.expiryDaysDefault);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const errorText = useCallback((code: string) => (s.errors as Record<string, string>)[code] ?? s.errors.generic, [s.errors]);

  const reload = useCallback(async () => {
    const result = await fetchShares(organizationId, target.kind, target.id);
    if (result.ok) setLinks(result.shares);
    else setError(errorText(result.code));
  }, [organizationId, target.kind, target.id, errorText]);

  // A native modal: the page behind is inert, Esc closes, focus returns to the button.
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    void reload();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (busy) return;
    const secret = passphrase.trim();
    if (secret && secret.length < SHARE_LIMITS.passphraseMin) {
      setError(s.passphraseHint);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createShareLink({ organizationId, kind: target.kind, targetId: target.id, allowComments, allowDownload, expiresInDays: days, passphrase: secret || null });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    setMade(new URL(sharePath(result.token), window.location.origin).toString());
    setPassphrase("");
    setCopied(null);
    void reload();
    window.setTimeout(() => linkRef.current?.select(), 0);
  }

  async function copyMade() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      setCopied(s.copied);
    } catch {
      linkRef.current?.select();
      setCopied(s.copyFailed);
    }
  }

  async function revoke(link: ShareLink) {
    if (typeof window !== "undefined" && !window.confirm(s.revokeConfirm)) return;
    setError(null);
    const result = await revokeShareLink(organizationId, link.id);
    if (!result.ok) setError(errorText(result.code));
    void reload();
  }

  return (
    <dialog ref={dialogRef} className="brh-dialog" aria-labelledby={`${id}-title`} onCancel={onClose} data-share-dialog>
      <div className="brh-head">
        <h2 id={`${id}-title`} className="brh-title">
          {s.title}
        </h2>
        <button type="button" className="brh-close" onClick={onClose} aria-label={s.close}>
          <svg className="brh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <p className="brh-lede">{target.kind === "storyboard" ? s.ledeStoryboard : s.lede}</p>

      <form
        className="brh-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        data-share-form
      >
        <label className="brh-check">
          <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} data-share-comments />
          <span>{s.allowComments}</span>
        </label>
        <label className="brh-check">
          <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-share-download />
          <span>{s.allowDownload}</span>
        </label>
        <div className="brh-row">
          <label className="brh-field">
            <span>{s.expiry}</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} data-share-expiry>
              {SHARE_EXPIRY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? s.expiryDay : fill(s.expiryDays, { days: d })}
                </option>
              ))}
            </select>
          </label>
          <label className="brh-field">
            <span>{s.passphrase}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              maxLength={SHARE_LIMITS.passphraseMax}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-describedby={`${id}-pass-hint`}
              data-share-passphrase
            />
          </label>
        </div>
        <p className="brh-hint" id={`${id}-pass-hint`}>
          {s.passphraseHint}
        </p>
        <div className="brh-actions">
          <button type="submit" className="brh-primary" disabled={busy} data-share-create>
            {busy ? s.creating : s.create}
          </button>
        </div>
      </form>

      {made && (
        <section className="brh-made" aria-labelledby={`${id}-made`} data-share-made>
          <h3 id={`${id}-made`} className="brh-subtitle">
            {s.createdTitle}
          </h3>
          <p className="brh-hint">{s.createdNote}</p>
          <div className="brh-link-row">
            <label className="brh-visually-hidden" htmlFor={`${id}-link`}>
              {s.linkLabel}
            </label>
            <input id={`${id}-link`} ref={linkRef} className="brh-link" value={made} readOnly onFocus={(e) => e.currentTarget.select()} data-share-link />
            <button type="button" className="brh-pill" onClick={() => void copyMade()} data-share-copy>
              {s.copy}
            </button>
          </div>
          <p className="brh-hint" role="status" aria-live="polite">
            {copied ?? ""}
          </p>
        </section>
      )}

      <p className="brh-error" role="alert">
        {error ?? ""}
      </p>

      <section className="brh-list" aria-labelledby={`${id}-list`}>
        <h3 id={`${id}-list`} className="brh-subtitle">
          {s.existing}
        </h3>
        {links === null ? null : links.length === 0 ? (
          <p className="brh-hint">{s.none}</p>
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link.id} className="brh-link-item" data-share-item={link.id} data-state={link.state}>
                <div className="brh-link-text">
                  <span className="brh-state" data-state={link.state}>
                    {s.state[link.state]}
                  </span>
                  <span className="brh-meta">
                    {fill(s.until, { date: day(link.expiresAt, locale) })} · {fill(s.views, { count: link.views })}
                  </span>
                  <span className="brh-tags">
                    {link.hasPassphrase && <span className="brh-tag">{s.withPassphrase}</span>}
                    {link.allowComments && <span className="brh-tag">{s.withComments}</span>}
                    {link.allowDownload && <span className="brh-tag">{s.withDownload}</span>}
                  </span>
                </div>
                {link.state === "live" && (
                  <button type="button" className="brh-text-btn" onClick={() => void revoke(link)} data-share-revoke={link.id}>
                    {s.revoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </dialog>
  );
}
