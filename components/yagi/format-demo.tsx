'use client';

import { useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { FilmPlayer } from './film-player';

export function FormatDemo({ t }: { t: Dictionary['yagi'] }) {
  const [variant, setVariant] = useState(false);
  const name = variant ? 'different-person' : 'designed-format';
  return <div className="yagi-demo" data-format-demo>
    <figure className="yagi-demo-source"><img src="/reel/studio-demo/reference-selfie.jpeg" alt={t.demoAlt} width="1206" height="2075" loading="lazy" />
      <figcaption>{t.demoSource}</figcaption></figure>
    <span className="yagi-demo-arrow" aria-hidden="true">↗</span>
    <div className="yagi-demo-result">
      <div className="yagi-demo-tabs" role="group" aria-label={t.demoLabel}>
        <button type="button" aria-pressed={!variant} onClick={() => setVariant(false)}>{t.demoFirst}</button>
        <button type="button" aria-pressed={variant} onClick={() => setVariant(true)}>{t.demoSecond}</button>
      </div>
      <div className="yagi-demo-screen"><FilmPlayer key={name} src={`/reel/studio-demo/${name}.mp4`} poster={`/reel/studio-demo/${name}.jpg`}
        label={variant ? t.demoSecond : t.demoFirst} labels={t} /></div>
    </div>
  </div>;
}
