'use client';
import { useState } from 'react';
import type { BrandHomeContent } from '@/lib/brands/workspace/types';
import type { BrandCopy } from './action-form';

export function WorkspacePreview({ content, b, title }: { content?: BrandHomeContent; b: BrandCopy; title: string }) {
  const [failed, setFailed] = useState(false);
  const image = content?.mime?.startsWith('image/');
  const video = content?.mime?.startsWith('video/');
  return <div className="bw-cover" data-workspace-preview>
    {!failed && content?.mediaUrl && image ? <img src={content.mediaUrl} alt={`${b.dashboard.preview}: ${content.title}`} loading="lazy" onError={() => setFailed(true)}/>
      : !failed && content?.mediaUrl && video ? <video src={`${content.mediaUrl}#t=0.1`} aria-label={content.title} muted playsInline preload="metadata" onError={() => setFailed(true)}/>
      : <div className="bw-cover-empty" aria-label={title}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 12a3 3 0 0 1 3-3h10l4 5h10a3 3 0 0 1 3 3v14H5Z"/><path d="M15 22h10m-5-5v10"/></svg><small>{content ? b.dashboard.file : b.dashboard.preparing}</small></div>}
    {content && <span className="bw-media-kind">{image ? b.dashboard.image : video ? b.dashboard.video : b.dashboard.file}</span>}
  </div>;
}
