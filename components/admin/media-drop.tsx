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

  const takeAudio = (file: File | null) => {
    if (!file) return;
    assign(audioInputRef.current, file);
    setAudioLabel(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)}MB`);
    setAudioUrl(URL.createObjectURL(file));
  };

  const takeVideo = (file: File | null) => {
    if (!file) return;
    assign(videoInputRef.current, file);
    setVideoLabel(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)}MB`);
    setVideoUrl(URL.createObjectURL(file));
    setDuration(0);
  };

  const takePoster = (file: File | null, label: string) => {
    if (!file) return;
    assign(posterInputRef.current, file);
    setPosterLabel(label);
    setPosterUrl(URL.createObjectURL(file));
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
        </div>
      )}
    </div>
  );
}
