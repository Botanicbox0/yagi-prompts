'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import type { SelfieLibrary, SelfieView } from '@/lib/identity/selfie-service';
import { selfieSavedOn } from '@/lib/identity/selfie-format';
import { interpolate } from '@/lib/i18n/format';
import { SelfieUploader } from './selfie-uploader';
import { PhotoCheckNote } from './photo-check-note';

/**
 * The saved photos as a grid (docs/IDENTITY-SELFIE.md §3). Two uses, one look:
 *
 *   pick    the studio sheet — each photo is one button; pressing it is the choice
 *   manage  the account card and `/identity/selfie` — default badge, "make default", delete
 *           (asked once more, then soft), a private note, and "M of N"
 *
 * N=1 reads as one photo and nothing else: no counter, no badge, no "make default".
 */
type Copy = Dictionary['selfie'];

/** "10장 중 3장" — only when there is more than one slot to count. */
export function selfieCountLabel(copy: Copy, count: number, limit: number): string | null {
  return limit > 1 ? interpolate(copy.count, { count: String(count), limit: String(limit) }) : null;
}

/**
 * What a screen reader hears for one photo: its note (or, in a grid, its place — two photos saved
 * the same day must not sound the same), "default", and the day it was saved.
 */
export function selfieName(copy: Copy, item: SelfieView, locale: string, index?: number): string {
  const title = item.label ?? (index === undefined ? null : interpolate(copy.photoNumber, { n: String(index + 1) }));
  return [title, item.isDefault ? copy.defaultBadge : null, selfieSavedOn(copy.savedOn, item.createdAt, locale)].filter(Boolean).join(' · ') || copy.savedTitle;
}

export interface SelfieGridProps {
  copy: Copy;
  locale: string;
  items: SelfieView[];
  limit: number;
  mode: 'pick' | 'manage';
  /** pick: the photo this order would use. */
  selectedId?: string | null;
  onPick?: (item: SelfieView) => void;
  /** manage: the photo whose change is in flight; its buttons wait. */
  pendingId?: string | null;
  onMakeDefault?: (item: SelfieView) => void;
  onDelete?: (item: SelfieView) => void;
  /** Resolves true once the note is saved, so the editor can close. */
  onLabel?: (item: SelfieView, label: string) => Promise<boolean>;
}

export function SelfieGrid({ copy, locale, items, limit, mode, selectedId = null, onPick, pendingId = null, onMakeDefault, onDelete, onLabel }: SelfieGridProps) {
  const countLabel = selfieCountLabel(copy, items.length, limit);
  const several = items.length > 1;
  return (
    <div data-selfie-grid data-selfie-mode={mode} data-selfie-full={items.length >= limit ? 'true' : 'false'} className="@container flex flex-col gap-3">
      {countLabel ? <p data-selfie-count className="font-mono text-[0.72rem] opacity-60">{countLabel}</p> : null}
      {/* Manage: one row per photo while the column is narrow (a phone, the selfie page's column), cards once it is wide. */}
      <ul role="list" className={mode === 'pick' ? 'grid grid-cols-3 gap-2 sm:gap-3' : 'grid grid-cols-1 gap-3 @lg:grid-cols-3'}>
        {items.map((item, index) => (
          <li key={item.id} data-selfie-item={item.id} data-selfie-default={item.isDefault ? 'true' : undefined}>
            {mode === 'pick'
              ? <PickTile copy={copy} item={item} name={selfieName(copy, item, locale, index)} badge={several && item.isDefault} selected={item.id === selectedId} onPick={onPick} />
              : <ManageCard copy={copy} locale={locale} item={item} name={selfieName(copy, item, locale, index)} title={item.label ?? interpolate(copy.photoNumber, { n: String(index + 1) })} badge={several && item.isDefault} canMakeDefault={several && !item.isDefault} pending={pendingId === item.id} anyPending={pendingId !== null} onMakeDefault={onMakeDefault} onDelete={onDelete} onLabel={onLabel} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DefaultBadge({ copy }: { copy: Copy }) {
  return <span data-selfie-default-badge className="absolute top-1.5 left-1.5 rounded-full bg-black/75 px-2 py-0.5 text-[0.66rem] font-semibold text-white">{copy.defaultBadge}</span>;
}

function PickTile({ copy, item, name, badge, selected, onPick }: { copy: Copy; item: SelfieView; name: string; badge: boolean; selected: boolean; onPick?: (item: SelfieView) => void }) {
  return (
    <button
      type="button"
      data-selfie-pick={item.id}
      aria-pressed={selected}
      aria-label={name}
      onClick={() => onPick?.(item)}
      className={['relative block aspect-[4/5] min-h-11 w-full overflow-hidden rounded-xl bg-black transition-[opacity,box-shadow]', selected ? 'opacity-100 ring-[3px] ring-accent' : 'opacity-80 hover:opacity-100'].join(' ')}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-only private route */}
      <img src={item.imageUrl} alt="" width={item.width} height={item.height} loading="lazy" className="h-full w-full object-cover" />
      {badge ? <DefaultBadge copy={copy} /> : null}
      {selected ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-accent text-white"><CheckIcon /></span> : null}
    </button>
  );
}

function ManageCard({ copy, locale, item, name, title, badge, canMakeDefault, pending, anyPending, onMakeDefault, onDelete, onLabel }: {
  copy: Copy; locale: string; item: SelfieView; name: string; title: string; badge: boolean; canMakeDefault: boolean; pending: boolean; anyPending: boolean;
  onMakeDefault?: (item: SelfieView) => void; onDelete?: (item: SelfieView) => void; onLabel?: (item: SelfieView, label: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label ?? '');
  // The note field and "keep it" take the focus as they appear (autoFocus); when they go, the button
  // that opened them gets it back — after the commit, so the button is there to take it.
  const [restore, setRestore] = useState<'edit' | 'delete' | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const noteId = useId();
  const savedOn = selfieSavedOn(copy.savedOn, item.createdAt, locale);
  const busy = pending || anyPending;
  useEffect(() => {
    if (!restore) return;
    (restore === 'edit' ? editRef : deleteRef).current?.focus({ preventScroll: true });
    setRestore(null);
  }, [restore]);
  const openNote = () => { setDraft(item.label ?? ''); setEditing(true); };
  const closeNote = () => { setEditing(false); setRestore('edit'); };
  const saveNote = async () => { if (busy) return; if (await onLabel?.(item, draft)) closeNote(); };

  return (
    <article aria-label={name} aria-busy={pending} className="flex h-full gap-3 rounded-2xl border border-hairline p-2 @lg:flex-col @lg:gap-2">
      <div className="relative aspect-[4/5] w-24 shrink-0 self-start overflow-hidden rounded-xl bg-black @lg:w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- owner-only private route */}
        <img src={item.imageUrl} alt={name} width={item.width} height={item.height} loading="lazy" className="h-full w-full object-cover" />
        {badge ? <DefaultBadge copy={copy} /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 @lg:px-1">
        <p className="text-sm font-medium break-words">{title}</p>
        {savedOn ? <p className="font-mono text-[0.68rem] opacity-55">{savedOn}</p> : null}
        {editing ? (
          <form className="mt-2 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void saveNote(); }}>
            <label htmlFor={noteId} className="text-xs font-medium">{copy.note}</label>
            <input
              id={noteId}
              autoFocus
              data-selfie-label-input
              value={draft}
              maxLength={40}
              placeholder={copy.notePlaceholder}
              aria-describedby={`${noteId}-hint`}
              disabled={busy}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeNote(); } }}
              className="min-h-11 w-full rounded-lg border border-hairline bg-transparent px-3 text-sm"
            />
            <p id={`${noteId}-hint`} className="text-[0.7rem] leading-snug opacity-55">{copy.noteHint}</p>
            <div className="flex gap-2">
              <button type="submit" data-selfie-label-save disabled={busy} className="inline-flex min-h-11 flex-1 items-center justify-center bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{copy.noteSave}</button>
              <button type="button" onClick={closeNote} className="inline-flex min-h-11 flex-1 items-center justify-center border border-current px-3 text-xs">{copy.noteCancel}</button>
            </div>
          </form>
        ) : confirming ? (
          <div role="group" aria-label={copy.removeConfirm} className="mt-2 rounded-xl border border-accent p-2">
            <p className="text-xs leading-relaxed">{copy.removeConfirm}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" data-selfie-delete-confirm disabled={busy} onClick={() => onDelete?.(item)} className="inline-flex min-h-11 flex-1 items-center justify-center bg-accent px-2 text-xs font-semibold text-white disabled:opacity-40">{copy.removeYes}</button>
              <button type="button" autoFocus onClick={() => { setConfirming(false); setRestore('delete'); }} className="inline-flex min-h-11 flex-1 items-center justify-center border border-current px-2 text-xs">{copy.removeNo}</button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-1">
            {canMakeDefault ? (
              <button type="button" data-selfie-make-default aria-label={`${copy.makeDefault} · ${name}`} disabled={busy} onClick={() => onMakeDefault?.(item)} className="inline-flex min-h-11 items-center border border-current px-3 font-label text-[0.66rem] tracking-[0.08em] uppercase disabled:opacity-40">
                {copy.makeDefault}
              </button>
            ) : null}
            <button ref={editRef} type="button" data-selfie-label-edit aria-label={`${copy.note} · ${name}`} disabled={busy} onClick={openNote} className="inline-flex min-h-11 items-center px-1 text-xs underline underline-offset-4 disabled:opacity-40">{copy.note}</button>
            <button ref={deleteRef} type="button" data-selfie-delete aria-label={`${copy.remove} · ${name}`} disabled={busy} onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center px-1 text-xs underline underline-offset-4 disabled:opacity-40">
              {copy.remove}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export interface SelfieLibraryPanelProps {
  copy: Copy;
  locale: string;
  initial: SelfieLibrary;
  /** `account`: the card on /account (manage + a link to add). `page`: /identity/selfie (manage + the uploader). */
  variant: 'account' | 'page';
  /** account: the selfie page. */
  manageHref?: string;
  /** page: open straight on the uploader (`?add=1`, or `?change=1` at one photo). */
  startEditing?: boolean;
  signinHref?: string;
  continueHref?: string | null;
  continueLabel?: string;
}

/**
 * The manage screens' state: the library as the server last answered it, the one change in flight,
 * and what to say about it. Every write answers the whole library, so the grid never guesses.
 */
export function SelfieLibraryPanel({ copy, locale, initial, variant, manageHref = '/identity/selfie', startEditing = false, signinHref, continueHref = null, continueLabel }: SelfieLibraryPanelProps) {
  const [library, setLibrary] = useState(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const items = library.items;
  const full = items.length >= library.limit;
  // The photo just saved here gets the advisory check; "change" from that advice replaces that photo.
  const [checkedId, setCheckedId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const checked = items.find(item => item.id === checkedId) ?? null;
  const target = items.find(item => item.id === replaceId) ?? items.find(item => item.id === library.defaultId) ?? items[0] ?? null;
  const [uploading, setUploading] = useState<'add' | 'replace' | null>(variant === 'page' && startEditing && items.length > 0 ? (full ? 'replace' : 'add') : null);
  const actionRef = useRef<HTMLElement | null>(null);
  const continueRef = useRef<HTMLAnchorElement>(null);
  // After a save, a delete or a closed uploader the control that had the focus is gone: hand it to
  // the way onward (or the add/change action) once the new screen is committed.
  const [focusTarget, setFocusTarget] = useState<'action' | 'continue' | null>(null);
  useEffect(() => {
    if (!focusTarget) return;
    ((focusTarget === 'continue' ? continueRef.current : null) ?? actionRef.current)?.focus({ preventScroll: true });
    setFocusTarget(null);
  }, [focusTarget]);

  const reload = async () => {
    try {
      const response = await fetch('/api/identity/selfie', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json() as SelfieLibrary & { ok?: boolean };
      if (response.ok && data.ok === true && Array.isArray(data.items)) setLibrary({ limit: data.limit, defaultId: data.defaultId, items: data.items });
    } catch { /* the grid keeps what it had */ }
  };

  async function change(method: 'PATCH' | 'DELETE', body: { id: string; isDefault?: true; label?: string | null }, done: string): Promise<boolean> {
    if (pendingId) return false;
    setPendingId(body.id);
    setError(null);
    setStatus('');
    try {
      const response = await fetch('/api/identity/selfie', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      const data = await response.json().catch(() => ({})) as Partial<SelfieLibrary> & { ok?: boolean; code?: string };
      if (data.code === 'sign_in_required' && signinHref) { window.location.assign(signinHref); return false; }
      if (response.ok && data.ok === true && Array.isArray(data.items)) {
        setLibrary({ limit: data.limit ?? library.limit, defaultId: data.defaultId ?? null, items: data.items });
        setStatus(done);
        return true;
      }
      // Changed in another tab: show what is there now.
      if (response.status === 404) { setError(copy.libraryChanged); await reload(); return false; }
      setError(copy.actionError);
      return false;
    } catch {
      setError(copy.actionError);
      return false;
    } finally {
      setPendingId(null);
    }
  }

  const onSaved = (saved: SelfieView, _replaced: boolean, next: SelfieLibrary | null) => {
    setUploading(null);
    setReplaceId(null);
    setCheckedId(saved.id);
    setError(null);
    if (next) setLibrary(next); else void reload();
    setStatus(copy.savedToast);
    setFocusTarget('continue');
  };
  const grid = (
    <SelfieGrid
      copy={copy}
      locale={locale}
      items={items}
      limit={library.limit}
      mode="manage"
      pendingId={pendingId}
      onMakeDefault={item => void change('PATCH', { id: item.id, isDefault: true }, copy.defaultSet)}
      onDelete={item => void change('DELETE', { id: item.id }, copy.removed).then(ok => { if (ok) setFocusTarget('action'); })}
      onLabel={(item, label) => change('PATCH', { id: item.id, label: label.trim() ? label : null }, copy.noteSaved)}
    />
  );
  const feedback = (
    <>
      <p role="status" aria-live="polite" data-selfie-library-status className={status ? 'text-sm font-medium text-accent' : 'sr-only'}>{status}</p>
      {error ? <p role="alert" data-selfie-library-error className="text-sm leading-relaxed text-accent">{error}</p> : null}
    </>
  );

  if (variant === 'account') {
    return (
      <div data-selfie-library data-selfie-variant="account" className="flex flex-col gap-4">
        {items.length ? (
          <>
            {grid}
            {items.length > 1 ? <p className="text-xs leading-relaxed opacity-60">{copy.libraryHint}</p> : null}
            <a
              ref={element => { actionRef.current = element; }}
              href={full ? `${manageHref}?change=1` : `${manageHref}?add=1`}
              {...(full ? { 'data-selfie-change-link': '' } : { 'data-selfie-add-link': '' })}
              className="inline-flex min-h-11 items-center self-start border border-current px-4 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
            >
              {full ? copy.change : `${copy.addPhoto} →`}
            </a>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed opacity-65">{copy.accountEmpty}</p>
            <a href={manageHref} className="inline-flex min-h-11 items-center self-start bg-accent px-5 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85">{copy.manage} →</a>
          </>
        )}
        {feedback}
      </div>
    );
  }

  return (
    <div data-selfie-library data-selfie-variant="page" className="flex flex-col gap-5">
      {items.length === 0 ? (
        <SelfieUploader copy={copy} locale={locale} initial={null} signinHref={signinHref} onSaved={onSaved} />
      ) : (
        <>
          {grid}
          {checked && !uploading ? (
            <PhotoCheckNote
              selfieId={checked.id}
              copy={copy.photoCheck}
              retakeLabel={copy.change}
              onRetake={() => { setReplaceId(checked.id); setUploading('replace'); }}
            />
          ) : null}
          {uploading ? (
            <div data-selfie-library-upload className="flex flex-col gap-4 border-t border-hairline pt-5">
              <p className="text-sm leading-relaxed opacity-75">
                {uploading === 'replace' ? (library.limit > 1 ? interpolate(copy.limitFull, { limit: String(library.limit) }) : copy.replaceNote) : copy.onlyYou}
              </p>
              <SelfieUploader
                key={uploading}
                copy={copy}
                locale={locale}
                initial={uploading === 'replace' ? target : null}
                startEditing
                replaceId={uploading === 'replace' ? target?.id ?? null : null}
                signinHref={signinHref}
                onSaved={onSaved}
                onEditingChange={editing => { if (!editing) { setUploading(null); setReplaceId(null); setFocusTarget('action'); } }}
              />
              {uploading === 'add' ? (
                <button type="button" data-selfie-add-cancel onClick={() => { setUploading(null); setFocusTarget('action'); }} className="min-h-11 self-start text-sm underline underline-offset-4">
                  {copy.cancelAdd}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {full ? (
                <button ref={element => { actionRef.current = element; }} type="button" data-selfie-change onClick={() => { setReplaceId(null); setUploading('replace'); }} className="inline-flex min-h-11 items-center border border-current px-4 font-label text-eyebrow uppercase transition-opacity hover:opacity-70">
                  {copy.change}
                </button>
              ) : (
                <button ref={element => { actionRef.current = element; }} type="button" data-selfie-add onClick={() => setUploading('add')} className="inline-flex min-h-11 items-center gap-2 border border-current px-4 font-label text-eyebrow uppercase transition-opacity hover:opacity-70">
                  <PlusIcon />{copy.addPhoto}
                </button>
              )}
              {continueHref ? <a ref={continueRef} data-selfie-continue href={continueHref} className="inline-flex min-h-11 items-center bg-accent px-5 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85">{continueLabel ?? copy.continue} →</a> : null}
            </div>
          )}
          <p className="text-xs leading-relaxed opacity-60">{copy.onlyYou}{items.length > 1 ? ` ${copy.libraryHint}` : ''}</p>
        </>
      )}
      {feedback}
    </div>
  );
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}
function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
