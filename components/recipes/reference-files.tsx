'use client';

import { useRef, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { PublicRecipe } from '@/lib/recipes/public';

type File = NonNullable<PublicRecipe['files']>[number];

/** The download address of a maker file: same route, same access rule, `Content-Disposition: attachment`. */
export function downloadHref(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}download=1`;
}

/**
 * The maker's reference files in "만드는 법" (founder, 2026-10-29: "눌렀을때 커지거나 … 다운로드도
 * 못받네"). Each thumbnail opens a viewer — a native `<dialog>`, Esc closes — with the file at full
 * size, previous/next, and a download button; the download is also one tap from the thumbnail row.
 */
export function ReferenceFiles({ files, copy }: { files: File[]; copy: Dictionary['makerRecipe'] }) {
  const h = copy.how;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const open = (at: number) => { setIndex(at); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();
  const step = (by: number) => setIndex((at) => (at + by + files.length) % files.length);
  const current = files[index] ?? null;
  const name = (at: number) => interpolate(copy.referenceLabel, { n: String(at + 1) });

  return (
    <>
      <ul data-recipe-how-files className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {files.map((file, i) => {
          const canDownload = Boolean(file.download) && !file.containsPerson;
          return (
            <li key={file.href} className="min-w-0">
              <button type="button" data-recipe-file-open={i + 1} onClick={() => open(i)} aria-label={`${name(i)} · ${h.viewFile}`} className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-hairline bg-[#F4F4F5]">
                {file.kind === 'image' ? (
                  <img src={file.href} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : file.kind === 'video' ? (
                  <video src={file.href} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-2 text-xs font-semibold text-[#09090B]">AUDIO</span>
                )}
              </button>
              {canDownload && file.download ? (
                <a href={file.download.includes('download=1') ? file.download : downloadHref(file.href)} download data-recipe-file-download={i + 1} className="mt-1.5 inline-flex min-h-9 items-center text-xs font-medium text-[#52525B] underline underline-offset-4 hover:text-[#09090B]">
                  {h.download}
                </a>
              ) : (
                <span data-recipe-file-view-only={i + 1} className="mt-1.5 inline-flex items-center rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[11px] font-medium text-[#52525B]">
                  화면 조회 전용 (인물 보호)
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <dialog
        ref={dialogRef}
        data-recipe-file-viewer
        aria-label={current ? name(index) : h.assets}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1);
          if (event.key === 'ArrowLeft') step(-1);
        }}
        className="m-auto h-[100dvh] max-h-none w-full max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {current && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm font-medium">{name(index)} · {interpolate(h.fileCount, { n: String(index + 1), total: String(files.length) })}</p>
              <div className="flex items-center gap-2">
                {!current.containsPerson && current.download ? (
                  <a href={current.download.includes('download=1') ? current.download : downloadHref(current.href)} download data-recipe-viewer-download className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-black">{h.download}</a>
                ) : (
                  <span data-recipe-viewer-view-only className="inline-flex min-h-9 items-center rounded-full bg-white/15 px-3 text-xs font-medium text-white">
                    화면 조회 전용 (인물 보호)
                  </span>
                )}
                <button type="button" onClick={close} aria-label={h.closeFile} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-2xl leading-none">×</button>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
              {current.kind === 'image' ? (
                <img key={current.href} src={current.href} alt={name(index)} className="max-h-full max-w-full object-contain" />
              ) : current.kind === 'video' ? (
                <video key={current.href} src={current.href} controls autoPlay playsInline className="max-h-full max-w-full" />
              ) : (
                <audio key={current.href} src={current.href} controls className="w-full max-w-md" />
              )}
              {files.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label={h.prevFile} className="absolute top-1/2 left-2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-xl">‹</button>
                  <button type="button" onClick={() => step(1)} aria-label={h.nextFile} className="absolute top-1/2 right-2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-xl">›</button>
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
