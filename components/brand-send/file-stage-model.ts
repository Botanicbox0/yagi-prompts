/**
 * Pure presentation model for the inbox thread file stage (`SendFileStage`).
 *
 * Imports nothing from `lib/**` except `import type`.
 */
import type { SendFileCard } from '@/lib/brand-rooms/send-contracts';
import { sendFileRefKey, type SendCopy } from './model';

export type FileStageVariant = 'image' | 'video' | 'audio' | 'unavailable';

export interface FileStageBox {
  width: number | null;
  height: number | null;
  ratio: number;
  aspectRatio: string;
}

export interface FileStageModel {
  variant: FileStageVariant;
  src: string | null;
  poster: string | null;
  label: string;
  unavailableText: string;
}

export const STAGE_MIN_RATIO = 0.25;
export const STAGE_MAX_RATIO = 4;

function cleanUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function fileStageBox(
  width: number | null | undefined,
  height: number | null | undefined,
  kind: SendFileCard['kind'],
): FileStageBox {
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    const rawRatio = safeW / safeH;
    const clamped = Math.max(STAGE_MIN_RATIO, Math.min(STAGE_MAX_RATIO, rawRatio));
    const aspectRatio =
      rawRatio >= STAGE_MIN_RATIO && rawRatio <= STAGE_MAX_RATIO
        ? `${safeW} / ${safeH}`
        : `${Math.round(clamped * 1000)} / 1000`;
    return { width: safeW, height: safeH, ratio: clamped, aspectRatio };
  }

  return kind === 'video'
    ? { width: null, height: null, ratio: 16 / 9, aspectRatio: '16 / 9' }
    : { width: null, height: null, ratio: 4 / 3, aspectRatio: '4 / 3' };
}

export function fileStageModel(
  file: SendFileCard,
  copy: Pick<SendCopy, 'kindImage' | 'kindVideo' | 'kindSound' | 'fileGone'>,
): FileStageModel {
  const kindLabel =
    file.kind === 'video' ? copy.kindVideo : file.kind === 'audio' ? copy.kindSound : copy.kindImage;
  const label = file.name?.trim() || kindLabel;

  if (!file.available) {
    return {
      variant: 'unavailable',
      src: null,
      poster: null,
      label: copy.fileGone,
      unavailableText: copy.fileGone,
    };
  }

  if (file.kind === 'image') {
    const src = cleanUrl(file.url) ?? cleanUrl(file.thumbUrl);
    if (src) {
      return {
        variant: 'image',
        src,
        poster: null,
        label,
        unavailableText: copy.fileGone,
      };
    }
  } else if (file.kind === 'video') {
    const src = cleanUrl(file.url);
    if (src) {
      return {
        variant: 'video',
        src,
        poster: cleanUrl(file.thumbUrl),
        label,
        unavailableText: copy.fileGone,
      };
    }
  } else if (file.kind === 'audio') {
    const src = cleanUrl(file.url);
    if (src) {
      return {
        variant: 'audio',
        src,
        poster: null,
        label,
        unavailableText: copy.fileGone,
      };
    }
  }

  return {
    variant: 'unavailable',
    src: null,
    poster: null,
    label: copy.fileGone,
    unavailableText: copy.fileGone,
  };
}

export function fileStageMediaKey(
  rootId: string,
  file: SendFileCard,
  variant: FileStageVariant,
): string {
  return `${rootId.toLowerCase()}:${sendFileRefKey(file.ref)}:${variant}`;
}
