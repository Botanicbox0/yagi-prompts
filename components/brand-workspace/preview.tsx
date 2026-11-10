'use client';
import { useState } from 'react';
import type { BrandHomeContent } from '@/lib/brands/workspace/types';
import type { BrandCopy } from './action-form';

/** `cover` is the campaign's chosen image; without one the latest content preview is used. */
export function WorkspacePreview({ content, cover, poster, b, title }: { content?: BrandHomeContent; cover?: string | null; poster?: string | null; b: BrandCopy; title: string }) {
  const [failed, setFailed] = useState(false), [coverFailed, setCoverFailed] = useState(false);
  const image = content?.mime?.startsWith('image/');
  const video = content?.mime?.startsWith('video/');
  if (cover && !coverFailed) return <div className="bw-cover" data-workspace-preview data-campaign-cover>
    <img src={cover} alt={`${b.cover.alt}: ${title}`} loading="eager" decoding="async" onError={() => setCoverFailed(true)}/>
  </div>;
  return <div className="bw-cover" data-workspace-preview>
    {!failed && content?.mediaUrl && image ? <img src={content.mediaUrl} alt={`${b.dashboard.preview}: ${content.title}`} loading="eager" decoding="async" onError={() => setFailed(true)}/>
      : !failed && content?.mediaUrl && video ? <video src={`${content.mediaUrl}#t=0.1`} poster={poster ?? '/reel/brands/house-french-blue-hero-1080p.jpg'} aria-label={content.title} muted playsInline preload="metadata" onError={() => setFailed(true)}/>
      : <div className="bw-cover-empty" aria-label={title}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 12a3 3 0 0 1 3-3h10l4 5h10a3 3 0 0 1 3 3v14H5Z"/><path d="M15 22h10m-5-5v10"/></svg><small>{content ? b.dashboard.file : b.dashboard.preparing}</small></div>}
    {content && <span className="bw-media-kind">{image ? b.dashboard.image : video ? b.dashboard.video : b.dashboard.file}</span>}
  </div>;
}
