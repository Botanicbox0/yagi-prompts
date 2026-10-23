'use client';

import { useId, useRef, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/influencers/rules';
import type { SocialAccountView } from '@/lib/influencers/service';

type Copy = Dictionary['social'];
export interface SocialState { influencer: boolean; items: SocialAccountView[] }

/**
 * `/identity/social` (docs/PLATFORM-2.0.md §17.1): the linked accounts and the one form that links
 * another. Built for one hand at 390px — one column, 48px targets, the submit button last. Every
 * write goes to `/api/identity/social` and the list re-renders from its answer, so what is shown is
 * always what the server holds.
 */
export function SocialAccountsPanel({ copy, locale, initial, signinHref }: { copy: Copy; locale: string; initial: SocialState; signinHref: string }) {
  const [state, setState] = useState(initial);
  const [platform, setPlatform] = useState<SocialPlatform>(initial.items.some(i => i.platform === 'instagram') ? (initial.items.some(i => i.platform === 'tiktok') ? 'youtube' : 'tiktok') : 'instagram');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const errorText = (code: unknown) => copy.errors[(typeof code === 'string' && code in copy.errors ? code : 'failed') as keyof Copy['errors']];

  function pick(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: FormData | Record<string, unknown>, key: string, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/identity/social', {
        method,
        credentials: 'same-origin',
        ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<SocialState> & { ok?: boolean; code?: string };
      if (data.code === 'sign_in_required') { window.location.assign(signinHref); return false; }
      if (response.ok && data.ok === true && Array.isArray(data.items)) {
        setState({ influencer: data.influencer === true, items: data.items });
        setStatus(done);
        return true;
      }
      setError(errorText(data.code));
      return false;
    } catch {
      setError(copy.errors.failed);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('platform', platform);
    if (!file) { setError(copy.errors.bad_photo); return; }
    form.set('photo', file);
    if (await send('POST', form, 'submit', copy.submitted)) {
      formRef.current?.reset();
      pick(null);
    }
  }

  const when = (iso: string | null) => formatDate(iso, locale) ?? '';
  const count = (n: number) => n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');
  const field = 'mt-2 min-h-12 w-full rounded-xl border border-hairline bg-white px-4 text-base outline-none focus:border-accent';

  return (
    <div data-social-panel className="flex flex-col gap-8">
      <p role="status" aria-live="polite" data-social-status className={status ? 'text-sm font-medium text-accent' : 'sr-only'}>{status}</p>
      {error ? <p role="alert" data-social-error className="rounded-xl border border-accent px-4 py-3 text-sm leading-relaxed text-accent">{error}</p> : null}

      <section aria-labelledby={`${id}-list`} data-social-list data-influencer={state.influencer ? 'true' : 'false'}>
        <h2 id={`${id}-list`} className="text-base font-semibold">{copy.listTitle}</h2>
        <p className={['mt-2 text-sm leading-relaxed', state.influencer ? 'font-medium text-accent' : 'opacity-70'].join(' ')}>{state.influencer ? copy.influencer : copy.notYet}</p>
        {state.items.length === 0 ? <p className="mt-4 text-sm opacity-60">{copy.empty}</p> : (
          <ul role="list" className="mt-4 flex flex-col gap-3">
            {state.items.map(item => (
              <li key={item.id} data-social-account={item.platform} data-social-state={item.state} className="rounded-2xl border border-hairline bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs opacity-60">{copy.platforms[item.platform]}</p>
                    <a href={item.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 block break-all text-base font-semibold underline-offset-4 hover:underline">@{item.handle}</a>
                  </div>
                  <span className={['shrink-0 rounded-full px-3 py-1 text-xs font-semibold', item.state === 'verified' ? 'bg-accent text-white' : item.state === 'rejected' ? 'border border-accent text-accent' : 'border border-hairline'].join(' ')}>{copy.state[item.state]}</span>
                </div>
                <div className="mt-3 space-y-1 text-sm leading-relaxed">
                  {item.state === 'verified' && item.measuredAt ? <p>{interpolate(copy.verifiedLine, { date: when(item.measuredAt), source: copy.sources[item.source] })}</p> : null}
                  {item.followerCount !== null ? <p className="font-medium">{interpolate(copy.followers, { count: count(item.followerCount) })}</p> : null}
                  {item.state === 'checking' ? <p className="opacity-70">{item.recheck ? copy.recheckLine : copy.checkingLine}</p> : null}
                  {item.state === 'checking' && item.claimedCount !== null ? <p className="opacity-60">{interpolate(copy.claimed, { count: count(item.claimedCount) })}</p> : null}
                  {item.state === 'rejected' ? <><p className="text-accent">{interpolate(copy.rejectedLine, { reason: item.reason ?? '' })}</p><p className="opacity-70">{copy.rejectedNext}</p></> : null}
                  {item.state === 'expired' ? <p className="opacity-70">{copy.expiredLine}</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {item.evidenceUrl ? <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">{copy.viewEvidence}</a> : null}
                  <button type="button" data-social-pool={item.poolConsent ? 'on' : 'off'} disabled={busy !== null} onClick={() => void send('PATCH', { id: item.id, poolConsent: !item.poolConsent }, item.id, item.poolConsent ? copy.poolOff : copy.pool)} className="inline-flex min-h-11 items-center underline underline-offset-4 disabled:opacity-40">
                    {item.poolConsent ? copy.poolToggleOff : copy.poolToggleOn}
                  </button>
                  <button type="button" data-social-unlink disabled={busy !== null} onClick={() => setConfirming(item.id)} className="inline-flex min-h-11 items-center underline underline-offset-4 disabled:opacity-40">{copy.unlink}</button>
                </div>
                <p className="text-xs opacity-55">{item.poolConsent ? copy.pool : copy.poolOff}</p>
                {confirming === item.id ? (
                  <div role="group" aria-label={copy.unlinkConfirm} className="mt-3 rounded-xl border border-accent p-3">
                    <p className="text-sm leading-relaxed">{copy.unlinkConfirm}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" data-social-unlink-confirm disabled={busy !== null} onClick={() => void send('DELETE', { id: item.id }, item.id, copy.unlink).then(() => setConfirming(null))} className="min-h-12 bg-accent px-3 text-sm font-semibold text-white disabled:opacity-40">{copy.unlink}</button>
                      <button type="button" autoFocus onClick={() => setConfirming(null)} className="min-h-12 border border-current px-3 text-sm">{copy.cancel}</button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form ref={formRef} onSubmit={event => void submit(event)} data-social-form aria-labelledby={`${id}-form`} className="flex flex-col gap-5 border-t border-hairline pt-6">
        <h2 id={`${id}-form`} className="text-base font-semibold">{copy.formTitle}</h2>
        <fieldset>
          <legend className="text-sm font-medium">{copy.platformLabel}</legend>
          <div role="radiogroup" className="mt-2 grid grid-cols-3 gap-2">
            {SOCIAL_PLATFORMS.map(p => (
              <label key={p} data-social-platform={p} className={['flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium', platform === p ? 'border-accent bg-accent text-white' : 'border-hairline bg-white'].join(' ')}>
                <input type="radio" name="platformChoice" value={p} checked={platform === p} onChange={() => setPlatform(p)} className="sr-only" />
                {copy.platforms[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium">
          {copy.profileUrlLabel}
          <input name="profileUrl" required maxLength={300} autoComplete="url" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder={copy.profileUrlPlaceholder[platform]} className={field} />
          <span className="mt-1.5 block text-xs font-normal opacity-60">{copy.profileUrlHint}</span>
        </label>
        <label className="block text-sm font-medium">
          {copy.countLabel}
          <input name="claimedCount" inputMode="numeric" pattern="[0-9,\s]*" maxLength={14} className={field} />
          <span className="mt-1.5 block text-xs font-normal opacity-60">{copy.countHint}</span>
        </label>
        <div>
          <p className="text-sm font-medium">{copy.photoLabel}</p>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => pick(event.currentTarget.files?.[0] ?? null)} />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" data-social-preview className="mt-2 max-h-64 w-auto rounded-xl border border-hairline" />
          ) : null}
          <button type="button" data-social-choose onClick={() => fileRef.current?.click()} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-current px-4 text-sm font-medium">
            {file ? copy.photoChange : copy.photoChoose}
          </button>
          <span className="mt-1.5 block text-xs opacity-60">{copy.photoHint}</span>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="poolConsent" value="yes" className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: 'var(--accent)' }} />
          <span><span className="block font-medium">{copy.poolLabel}</span><span className="mt-1 block text-xs opacity-60">{copy.poolHint}</span></span>
        </label>
        <p className="text-xs leading-relaxed opacity-60">{copy.privacyNote}</p>
        <button type="submit" data-social-submit disabled={busy !== null} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-white disabled:opacity-40">
          {busy === 'submit' ? copy.submitting : state.items.some(i => i.platform === platform) ? copy.resubmit : copy.submit}
        </button>
      </form>
    </div>
  );
}
