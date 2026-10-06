'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, scroll } from 'motion';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { FilmPlayer } from './film-player';

const films = CAMPAIGN_REEL.filter(film => film.orientation === 'landscape');

export function HeroStage({ t }: { t: Dictionary['yagi'] }) {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const film = films[active] ?? films[0];

  useEffect(() => {
    const frame = stage.current;
    if (!frame) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let release = () => {};
    function setup() {
      release();
      if (!frame || preference.matches) return;
      const visual = Array.from(frame.querySelectorAll<HTMLVideoElement | HTMLImageElement>('[data-yagi-film] > video, [data-yagi-film] > img'));
      const animation = animate(visual, { scale: [1, 1.075] }, { ease: 'linear' });
      const stop = scroll(animation, { target: frame, offset: ['start start', 'end start'] });
      release = () => { stop(); animation.cancel(); };
    }
    setup();
    preference.addEventListener('change', setup);
    return () => { release(); preference.removeEventListener('change', setup); };
  }, [active]);

  if (!film) return null;
  return <>
    <div className="yagi-hero-top"><p className="yagi-label">{t.eyebrow}</p><span className="yagi-stage-count" aria-hidden="true">0{active + 1} / 0{films.length}</span></div>
    <div ref={stage} className="yagi-stage" data-yagi-stage={film.id}>
      <FilmPlayer key={film.id} src={film.src} poster={film.poster} label={t.work[film.id].title} labels={t} autoplay eager />
      <div className="yagi-stage-title"><h1>{t.headline}</h1></div>
    </div>
    <div className="yagi-stage-bottom">
      <p data-service-definition>{t.definition}</p>
      <div className="yagi-stage-choices" role="group" aria-label={t.workLabel}>
        {films.map((item, i) => <button type="button" key={item.id} aria-pressed={active === i} onClick={() => setActive(i)}>
          <img src={item.poster} alt="" width="128" height="72" loading="lazy" />
          <span><span className="yagi-stage-number" aria-hidden="true">0{i + 1}</span>{t.work[item.id].title}</span>
        </button>)}
      </div>
    </div>
    <a className="yagi-text-link yagi-stage-explore" href="#work">{t.viewWork}<span aria-hidden="true">↓</span></a>
  </>;
}
