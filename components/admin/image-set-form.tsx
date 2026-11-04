'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { directUploadFailure, uploadMime } from '@/lib/admin/direct-upload';
import { imageFitsAspect, type ImageAspect } from '@/lib/images/engines';
import { IMAGE_SET_FRAMES_MAX, IMAGE_SET_FRAMES_MIN, normalizeSetPrompt, PROMPT_TEXT_MIN, setPromptIssue } from '@/lib/prompts/schemas';
import { interpolate } from '@/lib/i18n/format';
import { MAX_STEP_PROMPT_CHARS, setPromptTooLong } from '@/lib/recipes/schema';

import { put, sha256Hex, STAGING_URL_PATH, UploadRefused } from '@/components/admin/media-drop';

/**
 * The frames of an image set (2026-11-01). Dana's report: "프레임 자체가 없는데 어떻게 올리지" — the
 * site had no shape for a set, only a one-prompt form and a CLI script.
 *
 * One drop fills the list: images become frames in file-name order, and a prompt JSON dropped with
 * them (a list of `{ file_name, prompt }`, the production manifest's shape) fills the prompts. This
 * is the one admin form that needs JS: encoding and direct upload happen per frame in the browser,
 * and a refused submission has to keep all of it on screen.
 */

export type ImageSetLabels = Record<
  | 'engine' | 'aspect' | 'frames' | 'dropZone' | 'promptHint' | 'frameLabel' | 'thumbnail' | 'moveUp' | 'moveDown' | 'remove' | 'promptLabel'
  | 'publish' | 'errCount' | 'errTitles' | 'errImage' | 'errAspect' | 'errPromptShort' | 'errPromptLong' | 'errNoPhoto' | 'errOtherReference' | 'errBraces'
  | 'errManifest' | 'errFile' | 'uploading' | 'done' | 'failed' | 'invalid' | 'upload' | 'session' | 'uncertain' | 'retained' | 'publishing',
  string
>;

const WEBP_QUALITY = 0.88;
// chrome.tsx is server-side; these two class strings are its INPUT and LABEL.
const INPUT = "w-full border border-hairline bg-transparent px-2.5 py-1.5 font-mono text-code outline-none focus:border-accent";
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

interface Frame {
  id: string;
  name: string;
  preview: string;
  width: number;
  height: number;
  prompt: string;
  phase: 'uploading' | 'done' | 'failed';
  /** The receipt after a direct upload, or the encoded file where there is no signing service. */
  receipt: string;
  inline: File | null;
}

/** Same pixels, smaller file: a 2K PNG is ~6 MB and the pages render a plain `<img>`. */
async function encode(file: File): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
  if (!blob) throw new Error('encode_failed');
  // A browser without a WebP encoder answers PNG, which is still a valid frame.
  const extension = blob.type === 'image/webp' ? 'webp' : 'png';
  return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type }), width, height };
}

async function stage(file: File, onDone: (patch: Partial<Frame>) => void) {
  const mime = uploadMime(file.name, file.type);
  try {
    const minted = await fetch(STAGING_URL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'poster', filename: file.name, mime, size: file.size }),
    });
    if (!minted.ok) throw new UploadRefused(directUploadFailure(minted.status, await minted.json().catch(() => null)));
    const grant = (await minted.json()) as { direct?: boolean; key?: string; url?: string };
    if (grant.direct !== true || !grant.key || !grant.url) {
      onDone({ phase: 'done', inline: file });
      return;
    }
    await put(grant.url, file, mime, () => {});
    onDone({ phase: 'done', receipt: JSON.stringify({ key: grant.key, sha256: await sha256Hex(file), mime, size: file.size }) });
  } catch {
    onDone({ phase: 'failed' });
  }
}

function parseManifest(text: string): Map<string, { prompt: string; aspect: string | null }> | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return null;
    const out = new Map<string, { prompt: string; aspect: string | null }>();
    for (const item of raw as Array<Record<string, unknown>>) {
      if (typeof item?.file_name !== 'string' || typeof item.prompt !== 'string') return null;
      out.set(item.file_name, { prompt: item.prompt, aspect: typeof item.aspect_ratio === 'string' ? item.aspect_ratio : null });
    }
    return out;
  } catch {
    return null;
  }
}

export function ImageSetFields({
  labels,
  engines,
  aspects,
  defaultEngine,
  defaultAspect,
}: {
  labels: ImageSetLabels;
  engines: ReadonlyArray<{ id: string; label: string }>;
  aspects: ReadonlyArray<{ id: ImageAspect; label: string }>;
  defaultEngine: string;
  defaultAspect: ImageAspect;
}) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [thumbnail, setThumbnail] = useState(0);
  const [aspect, setAspect] = useState<ImageAspect>(defaultAspect);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Prompts dropped before or with an image wait here for the file name they belong to.
  const manifestRef = useRef(new Map<string, { prompt: string; aspect: string | null }>());
  const framesRef = useRef(frames);
  framesRef.current = frames;
  useEffect(() => () => framesRef.current.forEach((frame) => URL.revokeObjectURL(frame.preview)), []);

  const caps = { min: IMAGE_SET_FRAMES_MIN, max: IMAGE_SET_FRAMES_MAX };
  const patch = (id: string, change: Partial<Frame>) => setFrames((list) => list.map((frame) => (frame.id === id ? { ...frame, ...change } : frame)));

  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => {
      alertRef.current?.focus();
      alertRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function take(files: File[]) {
    setError('');
    const json = files.find((file) => file.name.toLowerCase().endsWith('.json'));
    if (json) {
      const parsed = parseManifest(await json.text());
      if (!parsed) return showError(labels.errManifest);
      manifestRef.current = parsed;
      const first = [...parsed.values()][0];
      if (first?.aspect && aspects.some((row) => row.id === first.aspect)) setAspect(first.aspect as ImageAspect);
      setFrames((list) => list.map((frame) => ({ ...frame, prompt: frame.prompt || parsed.get(frame.name)?.prompt || '' })));
    }
    const images = files
      .filter((file) => uploadMime(file.name, file.type).startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const room = IMAGE_SET_FRAMES_MAX - framesRef.current.length;
    if (images.length > room) showError(interpolate(labels.errCount, caps));
    for (const image of images.slice(0, Math.max(room, 0))) {
      try {
        const encoded = await encode(image);
        const id = crypto.randomUUID();
        setFrames((list) => [...list, {
          id, name: image.name, preview: URL.createObjectURL(encoded.file), width: encoded.width, height: encoded.height,
          prompt: manifestRef.current.get(image.name)?.prompt ?? '', phase: 'uploading', receipt: '', inline: null,
        }]);
        void stage(encoded.file, (change) => patch(id, change));
      } catch {
        showError(interpolate(labels.errFile, { name: image.name }));
      }
    }
  }

  function move(index: number, by: number) {
    const target = index + by;
    setFrames((list) => {
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    // The main image stays on the same picture, not the same position.
    setThumbnail((current) => (current === index ? target : current === target ? index : current));
  }

  function remove(index: number) {
    setFrames((list) => list.filter((_, at) => at !== index));
    setThumbnail((current) => (current === index ? 0 : current > index ? current - 1 : current));
  }

  /** The refusals an operator can fix here, in their words, before anything is posted. */
  function firstProblem(form: HTMLFormElement): string | null {
    const data = new FormData(form);
    if (String(data.get('title') ?? '').trim().length < 3 || !String(data.get('titleKo') ?? '').trim()) return labels.errTitles;
    if (frames.length < IMAGE_SET_FRAMES_MIN || frames.length > IMAGE_SET_FRAMES_MAX) return interpolate(labels.errCount, caps);
    for (const [index, frame] of frames.entries()) {
      const vars = { n: index + 1 };
      if (frame.phase !== 'done') return interpolate(labels.errImage, vars);
      if (!imageFitsAspect(frame.width, frame.height, aspect)) return interpolate(labels.errAspect, { ...vars, aspect });
      const prompt = frame.prompt.trim();
      if (prompt.length < PROMPT_TEXT_MIN) return interpolate(labels.errPromptShort, vars);
      const normalized = normalizeSetPrompt(prompt);
      if (setPromptTooLong(normalized)) return interpolate(labels.errPromptLong, { ...vars, max: MAX_STEP_PROMPT_CHARS });
      const issue = setPromptIssue(normalized);
      if (issue === 'no_photo') return interpolate(labels.errNoPhoto, vars);
      if (issue === 'other_reference') return interpolate(labels.errOtherReference, vars);
      if (issue === 'braces') return interpolate(labels.errBraces, vars);
    }
    return null;
  }

  async function submit(event: Event) {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (busy.current) return;
    const form = event.target;
    const problem = firstProblem(form);
    if (problem) return showError(problem);
    const body = new FormData(form);
    frames.forEach((frame, index) => {
      if (frame.inline) body.set(`frame${index}`, frame.inline);
    });
    busy.current = true;
    setPending(true);
    setError('');
    let navigating = false;
    try {
      const response = await fetch(form.action, { method: 'POST', body, headers: { accept: 'application/vnd.twings.admin-form+json' } });
      if (response.status === 401 || response.status === 403 || response.status === 404) return showError(labels.session);
      const result = (await response.json()) as { ok?: boolean; to?: unknown; code?: string; detail?: string };
      if (response.ok && result.ok === true && typeof result.to === 'string' && result.to.startsWith('/admin/')) {
        navigating = true;
        window.location.assign(result.to);
        return;
      }
      if (result.ok === false) {
        const lead = result.code === 'upload' || result.code === 'storage' ? labels.upload : result.code === 'invalid' ? labels.invalid : labels.uncertain;
        showError(result.detail ? `${lead} (${result.detail})` : lead);
      } else showError(labels.uncertain);
    } catch {
      // A lost response may follow a committed write. Never automatically retry this POST.
      showError(labels.uncertain);
    } finally {
      if (!navigating) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  // The form is the server's OpForm around this component, so the listener goes on it natively.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!form) return;
    const onSubmit = (event: Event) => void submitRef.current(event);
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  const drop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    void take(Array.from(event.dataTransfer.files));
  };

  return (
    <div ref={rootRef}>
      {error && (
        <div ref={alertRef} role="alert" tabIndex={-1} data-image-set-error className="mb-4 border border-accent p-3 font-mono text-[0.75rem]">
          <p>{error}</p>
          <p className="mt-1 opacity-60">{labels.retained}</p>
        </div>
      )}
      {pending && <p role="status" className="mb-3 font-mono text-[0.75rem]">{labels.publishing}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{labels.engine}</span>
          <select name="engine" defaultValue={defaultEngine} data-image-set-engine className={INPUT}>
            {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{labels.aspect}</span>
          <select name="aspect" value={aspect} onChange={(event) => setAspect(event.target.value as ImageAspect)} className={INPUT}>
            {aspects.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className={LABEL}>{labels.frames}</span>
        <p className="mt-1 font-mono text-[0.72rem] opacity-60">{labels.promptHint}</p>
        <button
          type="button"
          data-image-set-drop
          className={`mt-2 w-full border border-dashed px-4 py-6 text-center font-mono text-[0.72rem] transition-colors ${dragging ? 'border-accent text-accent' : 'border-hairline opacity-80 hover:opacity-100'}`}
          onClick={() => pickerRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          {interpolate(labels.dropZone, caps)}
        </button>
        <input
          ref={pickerRef}
          type="file"
          multiple
          accept="image/*,.json"
          aria-label={labels.frames}
          data-image-set-picker
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void take(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />
      </div>

      <input type="hidden" name="frameCount" value={frames.length} readOnly />
      <ol className="mt-3 flex flex-col gap-3">
        {frames.map((frame, index) => (
          <li key={frame.id} data-image-set-frame={index + 1} className="grid gap-3 border border-hairline p-3 sm:grid-cols-[8rem_1fr]">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
              <img src={frame.preview} alt="" className="w-full border border-hairline object-contain" />
              <p data-frame-phase={frame.phase} className={`mt-1 font-mono text-[0.65rem] ${frame.phase === 'failed' ? 'text-accent' : 'opacity-55'}`}>
                {frame.phase === 'uploading' ? labels.uploading : frame.phase === 'done' ? labels.done : labels.failed}
              </p>
              <p className="font-mono text-[0.65rem] break-all opacity-45">{frame.width}×{frame.height}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[0.72rem]">
                <span className="font-label text-eyebrow uppercase">{interpolate(labels.frameLabel, { n: index + 1 })}</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="thumbnail" value={index} checked={thumbnail === index} onChange={() => setThumbnail(index)} style={{ accentColor: 'var(--accent)' }} />
                  {labels.thumbnail}
                </label>
                <span className="ml-auto flex gap-3">
                  <button type="button" disabled={index === 0} className="underline disabled:opacity-30" onClick={() => move(index, -1)}>{labels.moveUp}</button>
                  <button type="button" disabled={index === frames.length - 1} className="underline disabled:opacity-30" onClick={() => move(index, 1)}>{labels.moveDown}</button>
                  <button type="button" className="underline" onClick={() => remove(index)}>{labels.remove}</button>
                </span>
              </div>
              <label className="block">
                <span className="sr-only">{labels.promptLabel}</span>
                <textarea
                  name={`frame${index}Prompt`}
                  rows={6}
                  value={frame.prompt}
                  placeholder={labels.promptLabel}
                  onChange={(event) => patch(frame.id, { prompt: event.target.value })}
                  className={INPUT}
                />
              </label>
              <input type="hidden" name={`frame${index}Ref`} value={frame.receipt} readOnly />
              <input type="hidden" name={`frame${index}Size`} value={`${frame.width}x${frame.height}`} readOnly />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4">
        <button type="submit" disabled={pending} data-template-publish className="border border-accent bg-accent px-4 py-2 font-label text-eyebrow uppercase text-white disabled:opacity-50">
          {labels.publish}
        </button>
      </div>
    </div>
  );
}
