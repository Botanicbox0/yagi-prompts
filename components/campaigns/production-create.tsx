'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { shrinkPhoto } from '@/lib/images/client-photo';
import { SelfiePhotoGuide } from '@/components/identity/selfie-photo-guide';
type Copy = Dictionary['campaigns']['production'];
export function CampaignCreate({ applicationId, locale, copy, photoGuide }: { applicationId: string; locale: string; copy: Copy; photoGuide: Dictionary['selfie'] }) {
  const [photo, setPhoto] = useState<File | null>(null), [preview, setPreview] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ file: File; id: string; blob: Blob | null } | null>(null), inFlight = useRef(false);
  useEffect(() => { if (!photo) { setPreview(null); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || !photo) return;
    const consent = new FormData(event.currentTarget).get('ownFace') === 'on';
    if (!consent) { setError(copy.errors.consent_required); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (pending.current?.file !== photo) pending.current = { file: photo, id: crypto.randomUUID(), blob: null };
      const request = pending.current!; request.blob ??= await shrinkPhoto(photo, 2_700_000);
      if (request.blob.size > 3_000_000) { setError(copy.errors.photo_too_large); return; }
      const form = new FormData(); form.set('applicationId', applicationId); form.set('requestId', request.id); form.set('locale', locale); form.set('ownFaceConsent', '1'); form.set('photo', request.blob, request.blob.type === 'image/png' ? 'photo.png' : 'photo.jpg');
      const response = await fetch('/api/campaign-production', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) { setError(copy.errors[result.code as keyof typeof copy.errors] ?? copy.unavailable); return; }
      const href = result.held ? result.verifyHref : result.href;
      if (typeof href !== 'string' || !href.startsWith('/')) throw Error('result');
      window.location.assign(href);
    } catch { setError(copy.errors.unavailable); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} data-campaign-create className="mt-8 grid gap-6" aria-busy={busy}>
    <fieldset disabled={busy} className="grid gap-5">
      <label className="block"><span className="block font-medium">{copy.photo}</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required onChange={e => { setPhoto(e.target.files?.[0] ?? null); pending.current = null; setError(''); }} className="mt-3 block w-full min-w-0 rounded-xl border border-hairline p-4 text-sm" /></label>
      {preview && <img src={preview} alt={copy.photo} className="max-h-64 max-w-full rounded-xl object-contain" />}
      <p className="text-sm leading-relaxed opacity-70">{copy.photoHint}</p>
      <details className="rounded-xl border border-hairline p-4"><summary className="cursor-pointer text-sm font-medium">{copy.guideTitle}</summary><SelfiePhotoGuide copy={photoGuide} /></details>
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input name="ownFace" type="checkbox" required className="mt-1 size-4 shrink-0" /><span>{copy.ownFace}</span></label>
      <p className="text-sm leading-relaxed opacity-60">{copy.imperfect}</p>
      {error && <p role="alert" className="text-accent text-sm leading-relaxed">{error}</p>}
      <button type="submit" disabled={!photo || busy} className="rounded-full bg-accent px-6 py-4 font-medium text-white disabled:opacity-40">{busy ? copy.starting : copy.create} →</button>
    </fieldset>
  </form>;
}
