'use client';

import { useEffect, useRef } from 'react';
import type { SendFileCard } from '@/lib/brand-rooms/send-contracts';
import type { SendCopy } from './model';
import { fileStageBox, fileStageMediaKey, fileStageModel } from './file-stage-model';
import styles from './file-stage.module.css';

export interface SendFileStageProps {
  rootId: string;
  file: SendFileCard;
  copy: Pick<SendCopy, 'kindImage' | 'kindVideo' | 'kindSound' | 'fileGone'>;
}

function AudioGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.glyph}>
      <path d="M9 17.5V6.5l9-2v11" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="15.5" cy="15.5" r="2.5" />
    </svg>
  );
}

function UnavailableGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.glyph}>
      <path d="M5 5l14 14" />
      <rect x="4" y="6" width="16" height="12" rx="2" />
    </svg>
  );
}

export function SendFileStage({ rootId, file, copy }: SendFileStageProps) {
  const model = fileStageModel(file, copy);
  const box = fileStageBox(file.width, file.height, file.kind);
  const mediaKey = fileStageMediaKey(rootId, file, model.variant);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    return () => {
      video?.pause?.();
      audio?.pause?.();
    };
  }, [mediaKey]);

  return (
    <figure className={styles.stage} data-send-file-stage={model.variant} data-send-stage-key={mediaKey}>
      {model.variant === 'image' && model.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={mediaKey}
          src={model.src}
          alt={model.label}
          width={box.width ?? undefined}
          height={box.height ?? undefined}
          draggable={false}
          className={styles.image}
          data-send-stage-media="image"
        />
      ) : model.variant === 'video' && model.src ? (
        <video
          key={mediaKey}
          ref={videoRef}
          src={model.src}
          poster={model.poster ?? undefined}
          width={box.width ?? undefined}
          height={box.height ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={model.label}
          className={styles.video}
          data-send-stage-media="video"
        />
      ) : model.variant === 'audio' && model.src ? (
        <div key={mediaKey} className={styles.audioWrap} data-send-stage-media="audio">
          <AudioGlyph />
          <span className={styles.audioName}>{model.label}</span>
          <audio
            ref={audioRef}
            src={model.src}
            controls
            preload="metadata"
            aria-label={model.label}
            className={styles.audio}
          />
        </div>
      ) : (
        <div key={mediaKey} className={styles.unavailable} data-send-stage-media="unavailable">
          <UnavailableGlyph />
          <span className={styles.unavailableText}>{model.unavailableText}</span>
        </div>
      )}
    </figure>
  );
}
