"use client";
/**
 * The share dialog with invitations (docs/BRAND-ROOMS-FEEDBACK.md §12), shown while `BRAND_ROOM_INVITES` is
 * on. Two sections:
 *
 *   People (the project): invite addresses as guests of this project room, view only or with comments,
 *   and the list of who has access — the brand's members (read-only), guests (permission, remove) and
 *   pending invitations (re-send, cancel). An invitee gets the whole project room, never another project.
 *
 *   Link access (one draft or storyboard, when the dialog was opened from one): "초대한 사람만" by default,
 *   with no link at all; "링크가 있는 누구나" only when the customer switches it, which reveals today's link
 *   options with the expiry preselected and a nudge towards a passphrase, and makes a link only on
 *   "링크 만들기". Switching back turns every live link of the item off after an inline confirmation.
 *
 * Opened from the room header it has the people section only. Techniques as the link-only dialog
 * (share.css): one frosted dialog, hairline rows, recessed fields, tabular numerals for days.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SHARE_EXPIRY_CHOICES, SHARE_LIMITS, sharePath, type ShareLink } from "@/lib/brand-rooms/share-contracts";
import { ROOM_INVITE_LIMITS, daysLeft, parseInviteEmails, type RoomInviteResult, type RoomPeople } from "@/lib/brand-rooms/invite-contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { createShareLink, fetchShares, revokeShareLink } from "../review/api";
import { cancelInvite, fetchPeople, removeGuest, resendInvite, sendInvites, setGuestPermission } from "./people-api";
import type { RoomShareInvites } from "./invites-context";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

type ShareCopy = Dictionary["roomsReview"]["share"];
type Target = { kind: "storyboard" | "review"; id: string };

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function InviteShareDialog({
  invites,
  target,
  shareCopy,
  onClose,
}: {
  invites: RoomShareInvites;
  target: Target | null;
  shareCopy: ShareCopy;
  onClose(): void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A native modal: the page behind is inert, Esc closes, focus returns to the button.
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="brh-dialog brh-dialog-wide" aria-labelledby={`${id}-title`} onCancel={onClose} data-share-dialog data-share-invites>
      <div className="brh-head">
        <h2 id={`${id}-title`} className="brh-title">
          {shareCopy.open}
        </h2>
        <button type="button" className="brh-close" onClick={onClose} aria-label={shareCopy.close}>
          <svg className="brh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <PeopleSection invites={invites} target={target} shareErrors={shareCopy.errors} />
      {target && <LinkAccessSection invites={invites} target={target} shareCopy={shareCopy} />}
    </dialog>
  );
}

/* ------------------------------------------------------------------ people */

function PeopleSection({ invites, target, shareErrors }: { invites: RoomShareInvites; target: Target | null; shareErrors: ShareCopy["errors"] }) {
  const { organizationId, projectId, locale } = invites;
  const p = invites.copy.people;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<RoomPeople | null>(null);
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [canComment, setCanComment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [handOff, setHandOff] = useState<RoomInviteResult[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const errorText = useCallback(
    (code: string, email?: string) => {
      // This dialog's own lines first, then the share dialog's (forbidden, not found, sign in, generic).
      const errors = { ...(shareErrors as Record<string, string>), ...(p.errors as Record<string, string>) };
      if (code === "invalid" && email) return fill(errors.email!, { email });
      return fill(errors[code] ?? errors.generic!, { email: email ?? "" });
    },
    [p.errors, shareErrors],
  );

  const reload = useCallback(async () => {
    const result = await fetchPeople(organizationId, projectId);
    if (result.ok) setPeople(result);
    else setError(errorText(result.code));
  }, [organizationId, projectId, errorText]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Move every complete address out of the field into chips; keep what is still being typed. */
  function absorb(text: string, final: boolean): string | null {
    const parts = text.split(/[\s,;]+/);
    const rest = final ? "" : (parts.pop() ?? "");
    const { emails, invalid } = parseInviteEmails(parts.join(" "));
    if (emails.length) setChips((current) => [...current, ...emails.filter((e) => !current.includes(e))]);
    if (invalid) {
      setError(errorText("invalid", invalid));
      return invalid + (rest ? ` ${rest}` : "");
    }
    return rest;
  }

  function onDraft(value: string) {
    setError(null);
    if (/[\s,;]/.test(value)) {
      const left = absorb(value, false);
      setDraft(left ?? "");
    } else setDraft(value);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (draft.trim()) {
        const left = absorb(draft, true);
        setDraft(left ?? "");
      } else void send();
    } else if (event.key === "Backspace" && !draft && chips.length) {
      setChips((current) => current.slice(0, -1));
    }
  }

  async function send() {
    if (busy) return;
    let all = chips;
    if (draft.trim()) {
      const { emails, invalid } = parseInviteEmails(draft);
      if (invalid) {
        setError(errorText("invalid", invalid));
        return;
      }
      all = [...chips, ...emails.filter((e) => !chips.includes(e))];
    }
    if (!all.length) {
      inputRef.current?.focus();
      return;
    }
    if (all.length > ROOM_INVITE_LIMITS.perSend) {
      setError(errorText("too_many"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    const result = await sendInvites({ organizationId, projectId, emails: all, canComment, target, locale, requestId: newRequestId() });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.code, result.email));
      return;
    }
    setChips([]);
    setDraft("");
    const invited = result.results.filter((r) => r.state === "sent" || r.state === "failed" || r.state === "skipped");
    const member = result.results.find((r) => r.state === "already_member");
    const notSent = result.results.filter((r) => r.link && (r.state === "failed" || r.state === "skipped"));
    setHandOff(notSent);
    setStatus(
      [invited.length ? fill(p.sent, { count: invited.length }) : null, notSent.length ? p.mailFailed : null, member ? errorText("already_member", member.email) : null]
        .filter(Boolean)
        .join(" "),
    );
    void reload();
  }

  async function resend(inviteId: string) {
    setError(null);
    const result = await resendInvite(organizationId, projectId, inviteId, locale);
    if (!result.ok) {
      setError(errorText(result.code));
      return;
    }
    const notSent = result.results.filter((r) => r.link);
    setHandOff(notSent);
    setStatus(notSent.length ? p.mailFailed : fill(p.sent, { count: 1 }));
    void reload();
  }

  async function cancel(inviteId: string, email: string) {
    if (!window.confirm(fill(p.cancelConfirm, { email }))) return;
    setError(null);
    const result = await cancelInvite(organizationId, projectId, inviteId);
    if (!result.ok) setError(errorText(result.code));
    setHandOff((current) => current.filter((r) => r.inviteId !== inviteId));
    void reload();
  }

  async function permission(userId: string, value: boolean) {
    setError(null);
    const result = await setGuestPermission(organizationId, projectId, userId, value);
    if (!result.ok) setError(errorText(result.code));
    void reload();
  }

  async function remove(userId: string, name: string) {
    if (!window.confirm(fill(p.removeConfirm, { name }))) return;
    setError(null);
    const result = await removeGuest(organizationId, projectId, userId);
    if (!result.ok) setError(errorText(result.code));
    void reload();
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
    } catch {
      setCopied(null);
    }
  }

  const permissionOptions = (
    <>
      <option value="comment">{p.permComment}</option>
      <option value="view">{p.permView}</option>
    </>
  );

  return (
    <section className="brh-section" aria-labelledby={`${id}-people`} data-share-people>
      <h3 id={`${id}-people`} className="brh-subtitle">
        {p.title}
      </h3>
      <p className="brh-hint">{p.scopeNote}</p>
      <form
        className="brh-invite"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        data-invite-form
      >
        <label className="brh-visually-hidden" htmlFor={`${id}-email`}>
          {p.emailLabel}
        </label>
        <div className="brh-chips" onClick={() => inputRef.current?.focus()}>
          {chips.map((email) => (
            <span key={email} className="brh-chip" data-invite-chip={email}>
              {email}
              <button type="button" className="brh-chip-x" aria-label={email} onClick={() => setChips((c) => c.filter((x) => x !== email))}>
                <svg className="brh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M7 7l10 10M17 7L7 17" />
                </svg>
              </button>
            </span>
          ))}
          <input
            id={`${id}-email`}
            ref={inputRef}
            type="text"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={chips.length ? "" : p.emailPlaceholder}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => {
              if (draft.trim() && /@/.test(draft)) setDraft(absorb(draft, true) ?? "");
            }}
            data-invite-email
          />
        </div>
        <div className="brh-invite-row">
          <label className="brh-field brh-field-inline">
            <span className="brh-visually-hidden">{p.permissionLabel}</span>
            <select value={canComment ? "comment" : "view"} onChange={(e) => setCanComment(e.target.value === "comment")} data-invite-permission>
              {permissionOptions}
            </select>
          </label>
          <button type="submit" className="brh-primary" disabled={busy} data-invite-send>
            {busy ? p.sending : p.send}
          </button>
        </div>
      </form>
      <p className="brh-hint" role="status" aria-live="polite" data-invite-status>
        {status ?? ""}
      </p>
      <p className="brh-error" role="alert" data-invite-error>
        {error ?? ""}
      </p>
      {handOff.length > 0 && (
        <ul className="brh-handoff" data-invite-handoff>
          {handOff.map((r) => (
            <li key={r.inviteId ?? r.email} className="brh-link-row">
              <input className="brh-link" value={r.link ?? ""} readOnly aria-label={r.email} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="brh-pill" onClick={() => r.link && void copy(r.link)} data-invite-copy={r.email}>
                {copied === r.link ? p.copied : p.copyLink}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4 className="brh-subtitle brh-subtitle-small">{p.listTitle}</h4>
      {people === null ? null : (
        <ul className="brh-people" data-invite-list>
          {people.members.map((m) => (
            <li key={`m-${m.userId}`} className="brh-person" data-person-member={m.userId}>
              <span className="brh-avatar" aria-hidden="true">
                {(m.name ?? m.email ?? "·").slice(0, 1).toUpperCase()}
              </span>
              <span className="brh-person-text">
                <span className="brh-person-name">{m.name ?? m.email ?? invites.roles[m.role]}</span>
                <span className="brh-meta">{m.name && m.email ? m.email : p.memberTag}</span>
              </span>
              <span className="brh-person-role">{invites.roles[m.role]}</span>
            </li>
          ))}
          {people.guests.map((g) => {
            const label = g.name ?? g.email ?? p.noEmail;
            return (
              <li key={`g-${g.userId}`} className="brh-person" data-person-guest={g.userId}>
                <span className="brh-avatar brh-avatar-guest" aria-hidden="true">
                  {label.slice(0, 1).toUpperCase()}
                </span>
                <span className="brh-person-text">
                  <span className="brh-person-name">
                    {label} <span className="brh-tag">{p.guestTag}</span>
                  </span>
                  <span className="brh-meta">
                    {g.email ?? p.noEmail}
                    {g.invitedEmail ? ` · ${g.invitedEmail}` : ""}
                  </span>
                </span>
                <span className="brh-person-actions">
                  <label className="brh-field brh-field-inline">
                    <span className="brh-visually-hidden">{p.permissionLabel}</span>
                    <select value={g.canComment ? "comment" : "view"} onChange={(e) => void permission(g.userId, e.target.value === "comment")} data-guest-permission={g.userId}>
                      {permissionOptions}
                    </select>
                  </label>
                  <button type="button" className="brh-text-btn" onClick={() => void remove(g.userId, label)} data-guest-remove={g.userId}>
                    {p.remove}
                  </button>
                </span>
              </li>
            );
          })}
          {people.pending.map((i) => {
            const days = daysLeft(i.expiresAt);
            return (
              <li key={`i-${i.id}`} className="brh-person" data-person-pending={i.id} data-mail-state={i.mailState ?? "none"}>
                <span className="brh-avatar brh-avatar-pending" aria-hidden="true">
                  {i.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="brh-person-text">
                  <span className="brh-person-name">{i.email}</span>
                  <span className="brh-meta">
                    {i.mailState === "failed" || i.mailState === "skipped" ? p.failed : days === 0 ? p.pendingToday : fill(p.pending, { days })}
                    {" · "}
                    {i.canComment ? p.permComment : p.permView}
                  </span>
                </span>
                <span className="brh-person-actions">
                  <button type="button" className="brh-text-btn" onClick={() => void resend(i.id)} data-invite-resend={i.id}>
                    {p.resend}
                  </button>
                  <button type="button" className="brh-text-btn" onClick={() => void cancel(i.id, i.email)} data-invite-cancel={i.id}>
                    {p.cancel}
                  </button>
                </span>
              </li>
            );
          })}
          {people.guests.length === 0 && people.pending.length === 0 && <li className="brh-hint brh-people-empty">{p.empty}</li>}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ link access */

const DATE = new Map<string, Intl.DateTimeFormat>();
function day(iso: string, locale: "ko" | "en"): string {
  let f = DATE.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" });
    DATE.set(locale, f);
  }
  return f.format(new Date(iso));
}

function LinkAccessSection({ invites, target, shareCopy }: { invites: RoomShareInvites; target: Target; shareCopy: ShareCopy }) {
  const { organizationId, locale } = invites;
  const l = invites.copy.link;
  const s = shareCopy;
  const id = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [mode, setMode] = useState<"invited" | "anyone">("invited");
  const [confirmOff, setConfirmOff] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [days, setDays] = useState<number>(SHARE_LIMITS.expiryDaysDefault);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const errorText = useCallback((code: string) => (s.errors as Record<string, string>)[code] ?? s.errors.generic, [s.errors]);
  const live = useMemo(() => (links ?? []).filter((link) => link.state === "live"), [links]);

  const reload = useCallback(async () => {
    const result = await fetchShares(organizationId, target.kind, target.id);
    if (result.ok) {
      setLinks(result.shares);
      // A link made before (or elsewhere) means the item is already open to anyone holding it.
      if (result.shares.some((link) => link.state === "live")) setMode("anyone");
    } else setError(errorText(result.code));
  }, [organizationId, target.kind, target.id, errorText]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function choose(next: "invited" | "anyone") {
    setError(null);
    if (next === "anyone") {
      setConfirmOff(false);
      setMode("anyone");
      return;
    }
    if (live.length) {
      setConfirmOff(true);
      return;
    }
    setMode("invited");
    setMade(null);
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    let failed: string | null = null;
    for (const link of live) {
      const result = await revokeShareLink(organizationId, link.id);
      if (!result.ok) failed = result.code;
    }
    setBusy(false);
    setConfirmOff(false);
    setMade(null);
    if (failed) setError(errorText(failed));
    else setMode("invited");
    void reload();
  }

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

  return (
    <section className="brh-section brh-section-link" aria-labelledby={`${id}-link`} data-share-link-access data-link-mode={mode}>
      <h3 id={`${id}-link`} className="brh-subtitle">
        {l.title}
      </h3>
      <label className="brh-field">
        <span className="brh-visually-hidden">{l.title}</span>
        <select value={mode} onChange={(e) => choose(e.target.value === "anyone" ? "anyone" : "invited")} disabled={links === null || busy} data-link-mode-select>
          <option value="invited">{l.invited}</option>
          <option value="anyone">{l.anyone}</option>
        </select>
      </label>
      <p className="brh-hint">{mode === "anyone" ? l.anyoneHelp : l.invitedHelp}</p>

      {confirmOff && (
        <div className="brh-confirm" role="alertdialog" aria-labelledby={`${id}-off`} data-link-off-confirm>
          <p id={`${id}-off`}>{l.offConfirm}</p>
          <div className="brh-actions">
            <button type="button" className="brh-pill" onClick={() => setConfirmOff(false)} data-link-off-cancel>
              {l.offCancel}
            </button>
            <button type="button" className="brh-primary" onClick={() => void turnOff()} disabled={busy} data-link-off-ok>
              {l.offOk}
            </button>
          </div>
        </div>
      )}

      {mode === "anyone" && !confirmOff && (
        <>
          {live.length === 0 && !made && (
            <form
              className="brh-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              data-share-form
            >
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
                    aria-describedby={`${id}-recommend`}
                    data-share-passphrase
                  />
                </label>
              </div>
              <p className="brh-hint" id={`${id}-recommend`} data-link-recommend>
                {l.recommend}
              </p>
              <label className="brh-check">
                <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} data-share-comments />
                <span>{s.allowComments}</span>
              </label>
              <label className="brh-check">
                <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-share-download />
                <span>{s.allowDownload}</span>
              </label>
              <div className="brh-actions">
                <button type="submit" className="brh-primary" disabled={busy} data-share-create>
                  {busy ? s.creating : l.create}
                </button>
              </div>
            </form>
          )}

          {made && (
            <section className="brh-made" aria-labelledby={`${id}-made`} data-share-made>
              <h4 id={`${id}-made`} className="brh-subtitle">
                {s.createdTitle}
              </h4>
              <p className="brh-hint">{s.createdNote}</p>
              <div className="brh-link-row">
                <label className="brh-visually-hidden" htmlFor={`${id}-made-link`}>
                  {s.linkLabel}
                </label>
                <input id={`${id}-made-link`} ref={linkRef} className="brh-link" value={made} readOnly onFocus={(e) => e.currentTarget.select()} data-share-link />
                <button type="button" className="brh-pill" onClick={() => void copyMade()} data-share-copy>
                  {s.copy}
                </button>
              </div>
              <p className="brh-hint" role="status" aria-live="polite">
                {copied ?? ""}
              </p>
            </section>
          )}

          {live.length > 0 && (
            <ul className="brh-live" data-share-live>
              {live.map((link) => (
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
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="brh-error" role="alert">
        {error ?? ""}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ room header */

/** "공유" at the room header: the people section for the whole project (no item, so no link access). */
export function ProjectShareButton({ invites, shareCopy }: { invites: RoomShareInvites; shareCopy: ShareCopy }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="brh-open" onClick={() => setOpen(true)} data-share-open="project" aria-haspopup="dialog">
        <svg className="brh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
        </svg>
        {shareCopy.open}
      </button>
      {open && <InviteShareDialog invites={invites} target={null} shareCopy={shareCopy} onClose={() => setOpen(false)} />}
    </>
  );
}
