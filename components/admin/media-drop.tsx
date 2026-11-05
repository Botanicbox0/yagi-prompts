'use client';

import { useEffect, useRef, useState } from 'react';
import {
  directUploadFailure,
  uploadFailureText,
  uploadMime,
  type UploadFailure,
  type UploadFailureLabels,
} from '@/lib/admin/direct-upload';
import { loadPromptDraft, savePromptDraft } from '@/lib/admin/prompt-draft';
import {
  POSTER_FOCUS_CENTER,
  dragPosterFocus,
  formatPosterFocus,
  posterObjectPosition,
  type PosterFocus,
} from '@/lib/prompts/poster-focus';

/**
 * Founder direction (2026-08-13) — the admin media fields grow hands.
 *
 * The RESULT CLIP is dropped (or picked) instead of hunted through a file dialog, and the POSTER
 * becomes a choice the founder makes while LOOKING at the clip: scrub to a frame and press
 * "use this frame", or drop a separate image — whichever wins.
 *
 * Progressive enhancement over the same multipart fields the server already reads: the two real
 * `<input type="file">` elements stay in the form (named exactly as before), and every gesture
 * here only ever ASSIGNS their `files` via `DataTransfer`. No JS → the inputs are ordinary file
 * pickers; the server path does not know this component exists.
 *
 * The frame capture is client-side only: the dropped clip plays into a hidden-scrubbed `<video>`,
 * the chosen frame is drawn to a canvas and encoded as JPEG, and THAT file lands in the poster
 * input. Nothing uploads until the form submits — the founder can change their mind for free.
 */

export interface MediaDropLabels extends UploadFailureLabels {
  videoZone: string;
  videoReplace: string;
  posterHeading: string;
  frameScrub: string;
  framePick: string;
  framePicked: string;
  frameLoading: string;
  frameUnavailable: string;
  posterZone: string;
  posterPicked: string;
  posterHint: string;
  cropHeading: string;
  cropHint: string;
  cropPosition: string;
  audioHeading: string;
  audioZone: string;
  audioSaved: string;
  audioLoading: string;
  audioUnavailable: string;
  /** Direct-upload status (2026-08-15). `{percent}` is interpolated. */
  uploading: string;
  uploaded: string;
  uploadedRetained?: string;
  uploadFailed: string;
  blockedUploading: string;
  blockedFailed: string;
}

function receiptSize(receiptStr?: string): number {
  if (!receiptStr) return 0;
  try {
    const parsed = JSON.parse(receiptStr);
    return typeof parsed?.size === 'number' ? parsed.size : 0;
  } catch {
    return 0;
  }
}

function assign(input: HTMLInputElement | null, file: File | null): void {
  if (!input) return;
  const bag = new DataTransfer();
  if (file) bag.items.add(file);
  input.files = bag.files;
}

function firstFile(items: DataTransfer | null, kind: 'video' | 'image' | 'audio'): File | null {
  if (!items) return null;
  for (const file of Array.from(items.files)) {
    if (uploadMime(file.name, file.type).startsWith(`${kind}/`)) return file;
  }
  return null;
}

/**
 * DIRECT UPLOAD (founder report, 2026-08-15): a 57.7MB clip came back as Vercel's own `413
 * PAYLOAD_TOO_LARGE`, produced by the platform before any of our code ran. A serverless request
 * body is capped at ~4.5MB, so a real video can never be POSTed through the admin door at all.
 *
 * So the bytes stop going through the door. The browser asks the server for a one-shot signed URL,
 * PUTs the file straight to storage, and the form carries a small JSON receipt instead. The file
 * input is CLEARED on success, which is the part that actually makes the form small enough to send.
 *
 * Every step degrades to the old behaviour rather than to a broken form: no JS → plain file inputs,
 * no signing service (the local driver) → the file posts inline, upload fails → the file is left in
 * the input and the operation refuses it the way it always did.
 */
export const STAGING_URL_PATH = '/api/admin/staging-url';

/**
 * The gateway's own ceiling, minus headroom for the rest of the form.
 *
 * Everything above this MUST have travelled directly to storage, and a submit carrying such a file
 * inline is not a fallback — it is a guaranteed 413 with a Vercel error page instead of the admin.
 * The founder saw exactly that twice (2026-08-15): the first time because the bytes went through the
 * door at all, the second time because a failed/incomplete direct upload silently handed the file
 * back to the old path. So this number is a REFUSAL, not a hint.
 */
const INLINE_MAX_BYTES = 4 * 1024 * 1024;

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  | { phase: 'done'; sizeBytes: number }
  | { phase: 'failed'; reason: UploadFailure };

/** A failure whose reason is already known, as opposed to anything else that throws. */
export class UploadRefused extends Error {
  constructor(readonly reason: UploadFailure) {
    super(`upload_${reason}`);
  }
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** XHR rather than fetch: only XHR reports upload progress, and a 57MB PUT needs a number. */
export function put(url: string, file: File, mime: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('content-type', mime);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        // 413 is the storage side's own size ceiling: the same fix as our cap, a smaller file.
        : reject(new UploadRefused(request.status === 413 ? 'too_large' : 'failed')),
    );
    request.addEventListener('error', () => reject(new Error('upload_failed')));
    request.addEventListener('abort', () => reject(new Error('upload_aborted')));
    request.send(file);
  });
}

export function MediaDrop({
  labels,
  videoName,
  posterName,
  audioName,
  existingVideoSrc,
  existingPosterSrc,
  existingPosterFocus,
  existingAudioSrc,
}: {
  labels: MediaDropLabels;
  videoName: string;
  posterName: string;
  /** Present ⇒ the form also takes an audio result (music/voice prompts, founder 2026-08-13). */
  audioName?: string;
  /**
   * The clip this row ALREADY has, as an admin-media path (founder question, 2026-08-14: "is
   * changing the thumbnail frame set up?"). Without it the scrubber only existed for a clip you
   * had just dropped, so re-picking a poster on a published prompt meant re-uploading the video.
   * Same-origin by construction, which is what keeps the canvas capture untainted.
   */
  existingVideoSrc?: string;
  /** The poster this row already has — shown so the panel says what it is about to replace. */
  existingPosterSrc?: string;
  /** Where that poster's 1:1 list thumbnail is cropped (staff report, 2026-11-02). */
  existingPosterFocus?: PosterFocus;
  /** The audio this row already has, so a save can be checked by ear (staff report, 2026-11-02). */
  existingAudioSrc?: string;
}) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterLabel, setPosterLabel] = useState<string | null>(null);
  const [posterFocus, setPosterFocus] = useState<PosterFocus>(existingPosterFocus ?? POSTER_FOCUS_CENTER);
  const [posterSize, setPosterSize] = useState<{ w: number; h: number } | null>(null);
  const cropDrag = useRef<{ pointerId: number; x: number; y: number; focus: PosterFocus } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null);
  const [existingAudioUrl, setExistingAudioUrl] = useState<string | null>(null);
  const [existingAudioFailed, setExistingAudioFailed] = useState(false);
  const [dragging, setDragging] = useState<'video' | 'poster' | 'audio' | null>(null);

  /** Per-slot upload progress, and the receipt each finished upload leaves in the form. */
  const [uploads, setUploads] = useState<Record<'video' | 'poster' | 'audio', UploadState>>({
    video: { phase: 'idle' },
    poster: { phase: 'idle' },
    audio: { phase: 'idle' },
  });
  const [receipts, setReceipts] = useState<Record<'video' | 'poster' | 'audio', string>>({
    video: '',
    poster: '',
    audio: '',
  });

  // M4's JS-free-admin contract survives: server HTML ships the two PLAIN file inputs; only a
  // hydrated client swaps them for the zones. No JS → ordinary pickers, same field names.
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);

  // Restore media receipts from draft on mount if not editing an existing row
  useEffect(() => {
    if (existingVideoSrc || existingPosterSrc || existingAudioSrc) return;
    try {
      const draft = loadPromptDraft(window.localStorage);
      if (!draft) return;
      const retainedLabel = labels.uploadedRetained ?? '업로드 완료 (임시저장 복원)';
      if (draft.videoRef) {
        setReceipts((c) => ({ ...c, video: draft.videoRef! }));
        setVideoLabel(draft.videoLabel ?? retainedLabel);
        setUploads((c) => ({ ...c, video: { phase: 'done', sizeBytes: receiptSize(draft.videoRef) } }));
      }
      if (draft.posterRef) {
        setReceipts((c) => ({ ...c, poster: draft.posterRef! }));
        setPosterLabel(draft.posterLabel ?? retainedLabel);
        setUploads((c) => ({ ...c, poster: { phase: 'done', sizeBytes: receiptSize(draft.posterRef) } }));
      }
      if (draft.audioRef) {
        setReceipts((c) => ({ ...c, audio: draft.audioRef! }));
        setAudioLabel(draft.audioLabel ?? retainedLabel);
        setUploads((c) => ({ ...c, audio: { phase: 'done', sizeBytes: receiptSize(draft.audioRef) } }));
      }
    } catch {
      // ignore
    }
  }, [existingVideoSrc, existingPosterSrc, existingAudioSrc, labels.uploadedRetained]);

  // Reset media when draft is discarded
  useEffect(() => {
    const onDraftClear = () => {
      setReceipts({ video: '', poster: '', audio: '' });
      setVideoUrl(null);
      setVideoLabel(null);
      setPosterUrl(null);
      setPosterLabel(null);
      setAudioUrl(null);
      setAudioLabel(null);
      setUploads({ video: { phase: 'idle' }, poster: { phase: 'idle' }, audio: { phase: 'idle' } });
      assign(videoInputRef.current, null);
      assign(posterInputRef.current, null);
      assign(audioInputRef.current, null);
    };
    window.addEventListener('twings:prompt-draft-clear', onDraftClear);
    return () => window.removeEventListener('twings:prompt-draft-clear', onDraftClear);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const [blocked, setBlocked] = useState<string | null>(null);

  /**
   * Hold the SUBMIT while bytes are still moving, or after a direct upload failed (2026-08-15).
   *
   * This is the half that was missing when the founder hit `413 PAYLOAD_TOO_LARGE` a second time. A
   * 57.7MB file takes real seconds to reach storage, and until it lands the file input still holds
   * it — so pressing save early posted the whole clip through a door that refuses 4.5MB. The submit
   * listener sits on the form itself rather than on a button, because Enter in any field submits too.
   */
  useEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!form) return;
    const onSubmit = (event: Event) => {
      const busy = (['video', 'poster', 'audio'] as const).filter((kind) => {
        const state = uploadsRef.current[kind];
        if (state.phase === 'uploading' || state.phase === 'failed') return true;
        const file = { video: videoInputRef, poster: posterInputRef, audio: audioInputRef }[
          kind
        ].current?.files?.[0];
        // A big file still sitting in the input means the direct upload did not happen.
        return file !== undefined && file.size > INLINE_MAX_BYTES;
      });
      if (busy.length === 0) {
        setBlocked(null);
        return;
      }
      event.preventDefault();
      const uploading = busy.some((kind) => uploadsRef.current[kind].phase === 'uploading');
      setBlocked(uploading ? labels.blockedUploading : labels.blockedFailed);
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [labels.blockedUploading, labels.blockedFailed]);

  /**
   * The row's clip is held as a blob while the panel is open (staff report, 2026-11-01: the frame
   * picker did nothing). The signed storage URL behind the admin media route lives 60 seconds, so a
   * scrub after that had nothing to seek on, and a canvas drawn from another origin cannot be read.
   */
  useEffect(() => {
    if (!existingVideoSrc) return;
    const abort = new AbortController();
    let url: string | null = null;
    void fetch(existingVideoSrc, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`clip_${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setExistingVideoUrl(url);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFrameState('unavailable');
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [existingVideoSrc]);

  /** The row's audio, held as a blob for the same reason: pressing play can come after the 60 seconds. */
  useEffect(() => {
    if (!existingAudioSrc) return;
    const abort = new AbortController();
    let url: string | null = null;
    void fetch(existingAudioSrc, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`audio_${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setExistingAudioUrl(url);
      })
      .catch(() => {
        if (!abort.signal.aborted) setExistingAudioFailed(true);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [existingAudioSrc]);

  const PLAIN_INPUT =
    'w-full border border-hairline bg-transparent px-2.5 py-1.5 font-mono text-code outline-none focus:border-accent';

  // Blob URLs leak until revoked; one effect owns each slot's lifecycle.
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (posterUrl) URL.revokeObjectURL(posterUrl); }, [posterUrl]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  /**
   * Ask for a signed URL, PUT the bytes, record the receipt, empty the file input.
   *
   * Order matters at the end: the receipt is written BEFORE the input is cleared, so there is no
   * instant at which the form carries neither the file nor its receipt. Any failure leaves the file
   * exactly where it was — the form still works, it just has to fit through the door.
   */
  const upload = async (
    kind: 'video' | 'poster' | 'audio',
    file: File,
    input: HTMLInputElement | null,
  ) => {
    setUploads((current) => ({ ...current, [kind]: { phase: 'uploading', percent: 0 } }));
    const mime = uploadMime(file.name, file.type);
    try {
      const minted = await fetch(STAGING_URL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          filename: file.name,
          mime,
          size: file.size,
        }),
      });
      if (!minted.ok) {
        // The refusal code (`too_large`/`bad_type`) is in the body; a guard 404 has none.
        const body: unknown = await minted.json().catch(() => null);
        throw new UploadRefused(directUploadFailure(minted.status, body));
      }
      const grant = (await minted.json()) as { direct?: boolean; key?: string; url?: string };
      if (grant.direct !== true || !grant.key || !grant.url) {
        // No signing service on this deployment. Inline is correct for a SMALL file and impossible
        // for a large one, so the large case is a failure the founder can read, not a silent retry
        // of the thing that already 413'd.
        if (file.size > INLINE_MAX_BYTES) throw new UploadRefused('failed');
        setUploads((current) => ({ ...current, [kind]: { phase: 'idle' } }));
        return;
      }

      await put(grant.url, file, mime, (percent) =>
        setUploads((current) => ({ ...current, [kind]: { phase: 'uploading', percent } })),
      );

      const receipt = JSON.stringify({
        key: grant.key,
        sha256: await sha256Hex(file),
        mime,
        size: file.size,
      });
      setReceipts((current) => ({ ...current, [kind]: receipt }));
      assign(input, null);
      setUploads((current) => ({ ...current, [kind]: { phase: 'done', sizeBytes: file.size } }));

      try {
        const currentDraft = loadPromptDraft(window.localStorage) ?? {
          version: 1,
          savedAt: new Date().toISOString(),
          title: '',
          titleKo: '',
          promptText: '',
          models: [],
          useCase: [],
          sourceUrl: '',
          processMd: '',
          processMdKo: '',
        };
        const label = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)}MB`;
        if (kind === 'video') {
          currentDraft.videoRef = receipt;
          currentDraft.videoLabel = label;
        } else if (kind === 'poster') {
          currentDraft.posterRef = receipt;
          currentDraft.posterLabel = label;
        } else if (kind === 'audio') {
          currentDraft.audioRef = receipt;
          currentDraft.audioLabel = label;
        }
        currentDraft.savedAt = new Date().toISOString();
        savePromptDraft(window.localStorage, currentDraft);
      } catch {
        // ignore
      }
    } catch (error) {
      setUploads((current) => ({
        ...current,
        [kind]: { phase: 'failed', reason: error instanceof UploadRefused ? error.reason : 'failed' },
      }));
    }
  };

  const takeAudio = (file: File | null) => {
    if (!file) return;
    assign(audioInputRef.current, file);
    setReceipts((current) => ({ ...current, audio: '' }));
    setAudioLabel(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)}MB`);
    setAudioUrl(URL.createObjectURL(file));
    void upload('audio', file, audioInputRef.current);
  };

  const takeVideo = (file: File | null) => {
    if (!file) return;
    assign(videoInputRef.current, file);
    setReceipts((current) => ({ ...current, video: '' }));
    setVideoLabel(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)}MB`);
    setVideoUrl(URL.createObjectURL(file));
    setDuration(0);
    setFrameState('loading');
    void upload('video', file, videoInputRef.current);
  };

  const takePoster = (file: File | null, label: string) => {
    if (!file) return;
    assign(posterInputRef.current, file);
    setReceipts((current) => ({ ...current, poster: '' }));
    setPosterLabel(label);
    setPosterUrl(URL.createObjectURL(file));
    setPosterFocus(POSTER_FOCUS_CENTER);
    setPosterSize(null);
    void upload('poster', file, posterInputRef.current);
  };

  /** One line per slot: the percentage while it climbs, the outcome after. */
  const progress = (kind: 'video' | 'poster' | 'audio') => {
    const state = uploads[kind];
    if (state.phase === 'idle') return null;
    const text =
      state.phase === 'uploading'
        ? labels.uploading.replace('{percent}', String(state.percent))
        : state.phase === 'done'
          ? labels.uploaded
          : uploadFailureText(state.reason, labels);
    return (
      <p
        data-upload-state={`${kind}:${state.phase}`}
        className={`font-mono text-[0.65rem] ${state.phase === 'failed' ? 'text-accent' : 'opacity-55'}`}
      >
        {text}
      </p>
    );
  };

  const captureFrame = () => {
    const video = previewRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const at = video.currentTime;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `poster-frame-${at.toFixed(2)}s.jpg`, { type: 'image/jpeg' });
        takePoster(file, labels.framePicked.replace('{time}', at.toFixed(1)));
      },
      'image/jpeg',
      0.92,
    );
  };

  const zone = (active: boolean) =>
    [
      'flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-4 py-5 text-center transition-colors',
      active ? 'border-accent text-accent' : 'border-hairline opacity-70 hover:opacity-100',
    ].join(' ');

  const previewSrc = videoUrl ?? existingVideoUrl;

  return (
    <div ref={rootRef} data-media-drop className="flex flex-col gap-4">
      {blocked && (
        <p
          data-upload-blocked
          className="border border-accent px-3 py-2 font-mono text-[0.72rem] text-accent"
        >
          {blocked}
        </p>
      )}
      {/* --- the clip ------------------------------------------------------ */}
      {enhanced && (
        <div
          className={zone(dragging === 'video')}
          onClick={() => videoInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging('video'); }}
          onDragLeave={() => setDragging(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(null);
            takeVideo(firstFile(e.dataTransfer, 'video'));
          }}
        >
          <span className="font-mono text-[0.72rem]">{videoLabel ?? labels.videoZone}</span>
          {videoLabel && <span className="font-mono text-[0.65rem] opacity-50">{labels.videoReplace}</span>}
        </div>
      )}
      {/* The REAL form field: a plain picker until hydration, invisible after — never absent. */}
      <input
        ref={videoInputRef}
        type="file"
        name={videoName}
        accept="video/*"
        className={enhanced ? 'sr-only' : PLAIN_INPUT}
        {...(enhanced ? { tabIndex: -1 } : {})}
        onChange={(e) => takeVideo(e.currentTarget.files?.[0] ?? null)}
      />
      <input type="hidden" name={`${videoName}Ref`} value={receipts.video} readOnly />
      {progress('video')}

      {/* The dropped clip wins; otherwise the one this row already has — so the frame picker
          works on a PUBLISHED prompt without re-uploading its video. */}
      {(videoUrl ?? existingVideoSrc) && (
        <div className="border border-hairline p-3">
          <video
            ref={previewRef}
            {...(previewSrc ? { src: previewSrc } : {})}
            muted
            playsInline
            preload="auto"
            className="max-h-64 w-full bg-black object-contain"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onLoadedData={() => setFrameState('ready')}
            // A codec this browser cannot decode (HEVC .mov on Windows) has no frame to pick.
            onError={() => setFrameState('unavailable')}
          />
          {frameState !== 'ready' && (
            <p data-frame-state={frameState} className="mt-2 font-mono text-[0.68rem] opacity-70">
              {frameState === 'loading' ? labels.frameLoading : labels.frameUnavailable}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex flex-1 items-center gap-2 font-mono text-[0.7rem] opacity-70">
              {labels.frameScrub}
              <input
                key={previewSrc}
                type="range"
                disabled={frameState !== 'ready'}
                min={0}
                max={Math.max(duration, 0.01)}
                step={0.04}
                defaultValue={0}
                className="min-w-32 flex-1"
                style={{ accentColor: 'var(--accent)' }}
                onInput={(e) => {
                  const video = previewRef.current;
                  if (video) video.currentTime = Number(e.currentTarget.value);
                }}
              />
            </label>
            <button
              type="button"
              disabled={frameState !== 'ready'}
              onClick={captureFrame}
              className="border border-current px-3 py-1.5 font-label text-[0.68rem] tracking-[0.1em] uppercase disabled:opacity-40"
            >
              {labels.framePick}
            </button>
          </div>
        </div>
      )}

      {/* --- the poster ---------------------------------------------------- */}
      <div>
        <p className="font-label text-eyebrow uppercase opacity-60">{labels.posterHeading}</p>
        {enhanced && (
          <div
            className={`mt-1.5 ${zone(dragging === 'poster')}`}
            onClick={() => posterInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging('poster'); }}
            onDragLeave={() => setDragging(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(null);
              const file = firstFile(e.dataTransfer, 'image');
              if (file) takePoster(file, labels.posterPicked.replace('{name}', file.name));
            }}
          >
            {/* The picked frame, or the poster this row is currently published with. */}
            {(posterUrl ?? existingPosterSrc) ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob preview / admin object
              <img
                src={posterUrl ?? existingPosterSrc}
                alt=""
                className="max-h-40 object-contain"
                data-poster-preview={posterUrl ? 'picked' : 'current'}
              />
            ) : null}
            <span className="font-mono text-[0.72rem]">{posterLabel ?? labels.posterZone}</span>
          </div>
        )}
        <p className="mt-1 font-mono text-[0.72rem] opacity-50">{labels.posterHint}</p>
        <input
          ref={posterInputRef}
          type="file"
          name={posterName}
          accept="image/*"
          className={enhanced ? 'sr-only' : `mt-1.5 ${PLAIN_INPUT}`}
          {...(enhanced ? { tabIndex: -1 } : {})}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0] ?? null;
            if (file) takePoster(file, labels.posterPicked.replace('{name}', file.name));
          }}
        />
        <input type="hidden" name={`${posterName}Ref`} value={receipts.poster} readOnly />
        {progress('poster')}

        {/* The wall's 1:1 thumbnail, dragged into place. No bytes change: the form saves a position. */}
        <input type="hidden" name={`${posterName}Focus`} value={formatPosterFocus(posterFocus)} readOnly />
        {enhanced && (posterUrl ?? existingPosterSrc) && (
          <div data-poster-crop className="mt-3 border border-hairline p-3">
            <p className="font-label text-eyebrow uppercase opacity-60">{labels.cropHeading}</p>
            <div
              className="mt-2 aspect-square w-full max-w-60 cursor-grab touch-none overflow-hidden bg-black active:cursor-grabbing"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                cropDrag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, focus: posterFocus };
              }}
              onPointerMove={(e) => {
                const drag = cropDrag.current;
                if (!drag || drag.pointerId !== e.pointerId || !posterSize) return;
                setPosterFocus(dragPosterFocus(drag.focus, e.clientX - drag.x, e.clientY - drag.y, posterSize, e.currentTarget.clientWidth));
              }}
              onPointerUp={() => { cropDrag.current = null; }}
              onPointerCancel={() => { cropDrag.current = null; }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- blob preview / admin object */}
              <img
                src={posterUrl ?? existingPosterSrc}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover"
                style={{ objectPosition: posterObjectPosition(posterFocus) }}
                onLoad={(e) => setPosterSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            </div>
            {/* The same control for a keyboard. A square poster has nothing to move. */}
            {posterSize && posterSize.w !== posterSize.h && (
              <label className="mt-2 flex max-w-60 items-center gap-2 font-mono text-[0.7rem] opacity-70">
                {labels.cropPosition}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={posterSize.w > posterSize.h ? posterFocus.x : posterFocus.y}
                  className="min-w-0 flex-1"
                  style={{ accentColor: 'var(--accent)' }}
                  onChange={(e) => {
                    const value = Number(e.currentTarget.value);
                    setPosterFocus((focus) => (posterSize.w > posterSize.h ? { ...focus, x: value } : { ...focus, y: value }));
                  }}
                />
              </label>
            )}
            <p className="mt-2 font-mono text-[0.68rem] opacity-50">{labels.cropHint}</p>
          </div>
        )}
      </div>

      {/* --- the audio result (optional slot) ------------------------------ */}
      {audioName && (
        <div>
          <p className="font-label text-eyebrow uppercase opacity-60">{labels.audioHeading}</p>
          {/* What the row has now. A newly picked file takes over, with its own player in the zone. */}
          {existingAudioSrc && !audioUrl && (
            <div
              data-audio-existing={existingAudioUrl ? 'ready' : existingAudioFailed ? 'unavailable' : 'loading'}
              className="mt-1.5 border border-hairline p-3"
            >
              <p className="font-mono text-[0.72rem]">{labels.audioSaved}</p>
              {existingAudioUrl ? (
                <audio controls preload="metadata" src={existingAudioUrl} className="mt-2 w-full max-w-80" />
              ) : (
                <p className="mt-2 font-mono text-[0.68rem] opacity-70">
                  {existingAudioFailed ? labels.audioUnavailable : labels.audioLoading}
                </p>
              )}
            </div>
          )}
          {enhanced && (
            <div
              className={`mt-1.5 ${zone(dragging === 'audio')}`}
              onClick={() => audioInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging('audio'); }}
              onDragLeave={() => setDragging(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
                takeAudio(firstFile(e.dataTransfer, 'audio'));
              }}
            >
              <span className="font-mono text-[0.72rem]">{audioLabel ?? labels.audioZone}</span>
              {audioUrl && (
                // Controls inside a click-to-pick zone: playing must not reopen the file dialog.
                <audio
                  controls
                  preload="metadata"
                  src={audioUrl}
                  className="mt-2 w-full max-w-80"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          )}
          <input
            ref={audioInputRef}
            type="file"
            name={audioName}
            accept="audio/*"
            className={enhanced ? 'sr-only' : `mt-1.5 ${PLAIN_INPUT}`}
            {...(enhanced ? { tabIndex: -1 } : {})}
            onChange={(e) => takeAudio(e.currentTarget.files?.[0] ?? null)}
          />
          <input type="hidden" name={`${audioName}Ref`} value={receipts.audio} readOnly />
          {progress('audio')}
        </div>
      )}
    </div>
  );
}
