'use client';

import { useEffect, useRef, useState } from 'react';

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

export interface MediaDropLabels {
  videoZone: string;
  videoReplace: string;
  posterHeading: string;
  frameScrub: string;
  framePick: string;
  framePicked: string;
  posterZone: string;
  posterPicked: string;
  posterHint: string;
  audioHeading: string;
  audioZone: string;
  /** Direct-upload status (2026-08-15). `{percent}` is interpolated. */
  uploading: string;
  uploaded: string;
  uploadFailed: string;
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
    if (file.type.startsWith(`${kind}/`)) return file;
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
const STAGING_URL_PATH = '/api/admin/staging-url';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  | { phase: 'done'; sizeBytes: number }
  | { phase: 'failed'; reason: string };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** XHR rather than fetch: only XHR reports upload progress, and a 57MB PUT needs a number. */
function put(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('content-type', file.type || 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`upload_failed_${request.status}`)),
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
}) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterLabel, setPosterLabel] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null);
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
    try {
      const minted = await fetch(STAGING_URL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      if (!minted.ok) throw new Error(`sign_failed_${minted.status}`);
      const grant = (await minted.json()) as { direct?: boolean; key?: string; url?: string };
      if (grant.direct !== true || !grant.key || !grant.url) {
        // No signing service on this deployment — the inline path is correct here.
        setUploads((current) => ({ ...current, [kind]: { phase: 'idle' } }));
        return;
      }

      await put(grant.url, file, (percent) =>
        setUploads((current) => ({ ...current, [kind]: { phase: 'uploading', percent } })),
      );

      const receipt = JSON.stringify({
        key: grant.key,
        sha256: await sha256Hex(file),
        mime: file.type || 'application/octet-stream',
        size: file.size,
      });
      setReceipts((current) => ({ ...current, [kind]: receipt }));
      assign(input, null);
      setUploads((current) => ({ ...current, [kind]: { phase: 'done', sizeBytes: file.size } }));
    } catch (error) {
      setUploads((current) => ({
        ...current,
        [kind]: { phase: 'failed', reason: error instanceof Error ? error.message : 'upload_failed' },
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
    void upload('video', file, videoInputRef.current);
  };

  const takePoster = (file: File | null, label: string) => {
    if (!file) return;
    assign(posterInputRef.current, file);
    setReceipts((current) => ({ ...current, poster: '' }));
    setPosterLabel(label);
    setPosterUrl(URL.createObjectURL(file));
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
          : labels.uploadFailed;
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

  return (
    <div data-media-drop className="flex flex-col gap-4">
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
            src={videoUrl ?? existingVideoSrc}
            muted
            playsInline
            preload="metadata"
            className="max-h-64 w-full bg-black object-contain"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex flex-1 items-center gap-2 font-mono text-[0.7rem] opacity-70">
              {labels.frameScrub}
              <input
                type="range"
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
              onClick={captureFrame}
              className="border border-current px-3 py-1.5 font-label text-[0.68rem] tracking-[0.1em] uppercase"
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
      </div>

      {/* --- the audio result (optional slot) ------------------------------ */}
      {audioName && (
        <div>
          <p className="font-label text-eyebrow uppercase opacity-60">{labels.audioHeading}</p>
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
