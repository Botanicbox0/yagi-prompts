'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dictionary } from '@/messages/en';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { BUTTON, FIELD } from './styles';

export type FormatFormCopy = Pick<Dictionary['community'], 'formatName' | 'medium' | 'video' | 'image' | 'example' | 'recipe' | 'rights' | 'busy' | 'submitFormat' | 'error' | 'errors' | 'formatNeedsScript'>;
type Revision = { id: string; title: string; medium: 'image' | 'video'; exampleUrl: string };

/**
 * Supplier submission through the existing `/api/community` `format` action (same-origin, bounded
 * body, rate limit, replay). The recipe is typed here and sent once; it is never read back.
 * Moved from the community hub so approved creators submit and follow review in one place.
 *
 * The API takes JSON only, so there is no native fallback. Fail safe instead: controls stay disabled
 * until hydration (nothing can be submitted early), and `method="post"` means even a stray native
 * submission puts the private recipe in a request body the API refuses, never in a GET URL.
 */
export function FormatSubmitForm({ copy, revision }: { copy: FormatFormCopy; revision?: Revision }) {
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    requestId.current ??= crypto.randomUUID();
    const body = {
      action: 'format', requestId: requestId.current,
      title: String(data.get('title') ?? ''), medium: String(data.get('medium') ?? ''),
      example: String(data.get('example') ?? ''), recipe: String(data.get('recipe') ?? ''),
      rights: data.get('rights') === 'on', ...(revision ? { revisionOf: revision.id } : {}),
    };
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) { window.location.assign(`${CREATOR_WORKSPACE_PATH}?ok=format`); return; }
      setNotice(copy.errors[result.code as keyof typeof copy.errors] ?? copy.error);
    } catch { setNotice(copy.error); } finally { setBusy(false); }
  }
  return <form data-creator-format-form method="post" action="/api/community" className="space-y-4" onSubmit={(event) => void submit(event)}>
    <noscript><p className="rounded-xl border border-hairline p-4 text-sm">{copy.formatNeedsScript}</p></noscript>
    <fieldset disabled={!ready} className="space-y-4">
    {notice ? <p role="alert" className="rounded-xl border border-accent p-4 text-sm">{notice}</p> : null}
    <label className="block text-sm">{copy.formatName}<input name="title" required minLength={3} maxLength={120} defaultValue={revision?.title} className={FIELD} /></label>
    <label className="block text-sm">{copy.medium}<select name="medium" defaultValue={revision?.medium ?? 'video'} className={FIELD}><option value="video">{copy.video}</option><option value="image">{copy.image}</option></select></label>
    <label className="block text-sm">{copy.example}<input name="example" type="url" required maxLength={2048} inputMode="url" defaultValue={revision?.exampleUrl} className={FIELD} /></label>
    <label className="block text-sm">{copy.recipe}<textarea name="recipe" required minLength={20} maxLength={20000} rows={6} className={FIELD} autoComplete="off" /></label>
    <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="rights" required className="mt-1" />{copy.rights}</label>
    <button disabled={busy} className={BUTTON}>{busy ? copy.busy : copy.submitFormat}</button>
    </fieldset>
  </form>;
}
