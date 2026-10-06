'use client';

import { useState } from 'react';
import { CAMPAIGN_REEL, type ReelId } from '@/lib/campaigns/showreel';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { FilmPlayer } from './film-player';

const categories: Record<ReelId, 'beauty' | 'fashion' | 'culture'> = { beauty: 'beauty', retro1: 'culture', retro2: 'culture', highteen: 'fashion' };
export function WorkGallery({ t }: { t: Dictionary['yagi'] }) {
  const [filter, setFilter] = useState<keyof typeof t.filters>('all');
  const items = CAMPAIGN_REEL.filter(item => filter === 'all' || categories[item.id] === filter);
  return <div data-yagi-gallery data-filter={filter}>
    <div className="yagi-filters" role="group" aria-label={t.workLabel}>
      {(Object.keys(t.filters) as Array<keyof typeof t.filters>).map(key => <button key={key} type="button"
        aria-pressed={filter === key} onClick={() => setFilter(key)}>{t.filters[key]}</button>)}
    </div>
    <div className="yagi-work-grid" aria-live="polite">
      {items.map(item => <figure key={item.id} className={`yagi-work-item yagi-work-${item.orientation}`} data-yagi-work={item.id}>
        <div className="yagi-work-media" style={{ aspectRatio: item.ratio }}>
          <FilmPlayer src={item.src} poster={item.poster} label={t.work[item.id].title} labels={t} previewOnHover />
        </div>
        <figcaption><div>
          <p className="yagi-label">{t.work[item.id].category}</p><h3>{t.work[item.id].title}</h3><p>{t.work[item.id].description}</p>
        </div></figcaption>
      </figure>)}
    </div>
  </div>;
}
