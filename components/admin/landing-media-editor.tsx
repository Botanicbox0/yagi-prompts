'use client';

import { useRef, useState, type DragEvent } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * `/admin/landing-media` tiles (lib/content/landing-media.ts). Drop an image on a tile, or click it,
 * and it is replaced in place: the browser scales it to the slot's width first (a phone photo would
 * otherwise exceed Vercel's ~4.5 MB request limit before our code runs), then posts it through the
 * one admin door, which re-encodes and stores it.
 */

type Copy = Dictionary['landingMedia'];

export interface EditorSlot {
  key: string;
  name: string;
  ratio: string;
  width: number;
  alpha: boolean;
  defaultSrc: string;
  currentSrc: string;
  replaced: boolean;
}

export interface EditorGroup {
  id: string;
  title: string;
  slots: EditorSlot[];
}

export interface EditorPage {
  id: string;
  title: string;
  href: string;
  groups: EditorGroup[];
}

const BACK = '/admin/landing-media';
const INLINE_LIMIT = 3.8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

function aspect(ratio: string): string | undefined {
  const match = /^(\d+):(\d+)$/.exec(ratio);
  return match ? `${match[1]} / ${match[2]}` : undefined;
}

async function encode(file: File, slot: EditorSlot): Promise<Blob> {
  if (!ACCEPT.split(',').includes(file.type)) throw new Error('notImage');
  if (file.size > 20 * 1024 * 1024) throw new Error('tooLarge');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, slot.width / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // WebP where the browser can encode it (Safari answers PNG); JPEG keeps photos small without it.
  let blob = await toBlob('image/webp', 0.92);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(slot.alpha ? 'image/png' : 'image/jpeg', 0.9);
  if (!blob) throw new Error('failed');
  if (blob.size > INLINE_LIMIT) blob = (await toBlob('image/webp', 0.8)) ?? blob;
  return blob;
}

async function post(fields: Record<string, string | Blob>, filename?: string): Promise<boolean> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') body.set(key, value);
    else body.set(key, value, filename);
  }
  const response = await fetch('/admin/do', { method: 'POST', body, headers: { Accept: 'application/json' } });
  const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  return Boolean(response.ok && result?.ok);
}

function Tile({ slot, copy, disabled, onChange }: { slot: EditorSlot; copy: Copy; disabled: boolean; onChange: (key: string, replaced: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState(slot.currentSrc);
  const [replaced, setReplaced] = useState(slot.replaced);
  const [state, setState] = useState<'idle' | 'over' | 'saving' | 'saved' | 'restored' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const replace = async (file: File | undefined) => {
    if (!file || disabled) return;
    setState('saving');
    setError(null);
    try {
      const blob = await encode(file, slot);
      const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
      const name = `${file.name.replace(/\.[^.]+$/, '') || slot.name}.${ext}`;
      if (!(await post({ _op: 'landingMedia.replace', _back: BACK, slot: slot.key, file: blob }, name))) throw new Error('failed');
      setSrc(URL.createObjectURL(blob));
      setReplaced(true);
      onChange(slot.key, true);
      setState('saved');
    } catch (cause) {
      const code = cause instanceof Error && (cause.message === 'tooLarge' || cause.message === 'notImage') ? cause.message : 'failed';
      setError(copy[code]);
      setState('error');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const reset = async () => {
    setState('saving');
    setError(null);
    if (await post({ _op: 'landingMedia.reset', _back: BACK, slot: slot.key })) {
      setSrc(slot.defaultSrc);
      setReplaced(false);
      onChange(slot.key, false);
      setState('restored');
    } else {
      setError(copy.failed);
      setState('error');
    }
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setState('idle');
    void replace(event.dataTransfer.files[0]);
  };

  const status = state === 'saving' ? copy.saving : state === 'saved' ? copy.saved : state === 'restored' ? copy.restored : null;

  return (
    <li data-landing-slot={slot.key} data-replaced={replaced ? 'true' : undefined} className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || state === 'saving'}
        onClick={() => input.current?.click()}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setState('over'); }}
        onDragLeave={() => setState((current) => (current === 'over' ? 'idle' : current))}
        onDrop={drop}
        aria-label={`${copy.replace}: ${slot.name}`}
        className={`group relative block w-full overflow-hidden border text-left transition-colors ${state === 'over' ? 'border-accent' : 'border-hairline hover:border-accent'} disabled:cursor-not-allowed`}
        style={{
          aspectRatio: aspect(slot.ratio) ?? '1 / 1',
          background: slot.alpha ? 'repeating-conic-gradient(#f1f1f1 0% 25%, #fff 0% 50%) 50% / 16px 16px' : '#f4f4f5',
        }}
      >
        <img src={src} alt="" loading="lazy" decoding="async" className={`h-full w-full ${slot.alpha || slot.ratio === 'free' ? 'object-contain p-2' : 'object-cover'} ${state === 'saving' ? 'opacity-40' : ''}`} />
        <span className={`pointer-events-none absolute inset-0 grid place-items-center bg-black/45 font-label text-eyebrow uppercase text-white transition-opacity ${state === 'over' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
          {state === 'over' ? copy.drop : copy.replace}
        </span>
        <span className={`absolute left-1.5 top-1.5 px-1.5 py-0.5 font-label text-[0.62rem] uppercase tracking-[0.08em] ${replaced ? 'bg-accent text-white' : 'bg-white/90 text-black/60'}`}>
          {replaced ? copy.replaced : copy.original}
        </span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void replace(event.target.files?.[0])} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[0.7rem]">{slot.name}</p>
          <p className="font-mono text-[0.62rem] opacity-50">{slot.ratio === 'free' ? '' : `${slot.ratio} · `}{slot.width}px</p>
        </div>
        {replaced && (
          <button type="button" onClick={() => void reset()} disabled={state === 'saving'} className="shrink-0 border border-hairline px-1.5 py-0.5 font-label text-[0.62rem] uppercase hover:border-accent hover:text-accent">
            {copy.reset}
          </button>
        )}
      </div>
      <p aria-live="polite" className={`min-h-[1em] font-mono text-[0.62rem] ${error ? 'text-accent' : 'opacity-60'}`}>{error ?? status ?? ''}</p>
    </li>
  );
}

export function LandingMediaEditor({ pages, copy, disabled }: { pages: EditorPage[]; copy: Copy; disabled: boolean }) {
  const [active, setActive] = useState(pages[0]?.id ?? '');
  const [replaced, setReplaced] = useState(() => new Set(pages.flatMap((p) => p.groups.flatMap((g) => g.slots.filter((slot) => slot.replaced).map((slot) => slot.key)))));
  const onChange = (key: string, on: boolean) => setReplaced((current) => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  const page = pages.find((candidate) => candidate.id === active) ?? pages[0];
  if (!page) return null;
  return (
    <div data-landing-media-editor className="mt-8">
      <div role="tablist" className="flex flex-wrap items-center gap-2">
        {pages.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === page.id}
            onClick={() => setActive(candidate.id)}
            className={`border px-3 py-1.5 font-label text-eyebrow uppercase ${candidate.id === page.id ? 'border-accent bg-accent text-white' : 'border-hairline hover:border-accent'}`}
          >
            {candidate.title}
          </button>
        ))}
        <a href={page.href} target="_blank" rel="noreferrer" className="ml-auto font-label text-eyebrow uppercase text-accent underline-offset-4 hover:underline">
          {copy.open} ↗
        </a>
      </div>
      {/* Every page stays mounted (hidden when not chosen) so a tile keeps what was just saved. */}
      {pages.map((candidate) => (
        <div key={candidate.id} role="tabpanel" hidden={candidate.id !== page.id} data-landing-media-page={candidate.id}>
          {candidate.groups.map((group) => {
            const count = group.slots.filter((slot) => replaced.has(slot.key)).length;
            return (
              <section key={group.id} data-landing-media-group={group.id} className="mt-8 border border-hairline">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
                  <h2 className="font-label text-eyebrow uppercase">{group.title}</h2>
                  <span className="font-mono text-code opacity-60">{count}/{group.slots.length} {copy.replacedCount}</span>
                </header>
                <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {group.slots.map((slot) => <Tile key={slot.key} slot={slot} copy={copy} disabled={disabled} onChange={onChange} />)}
                </ul>
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}
