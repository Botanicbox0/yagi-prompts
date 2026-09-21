'use client';

import { useEffect, useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';
import styles from './brand-entry.module.css';

type Copy = ReturnType<typeof getDictionary>['auth']['brandEntry'];
const SLIDES = [
  { key: 'request', image: 'retro-phone-01.jpg' },
  { key: 'review', image: 'highteen.jpg' },
  { key: 'report', image: 'beauty-rose.jpg' },
] as const;

/** Auth stays server-rendered; this island only changes the public showcase. */
export function BrandShowcase({ copy, assetOrigin }: { copy: Copy; assetOrigin: string }) {
  const [active, setActive] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRotating(!preference.matches);
    const stopForReducedMotion = () => { if (preference.matches) setRotating(false); };
    const updateVisibility = () => setVisible(!document.hidden);
    updateVisibility();
    preference.addEventListener('change', stopForReducedMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', stopForReducedMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const playing = rotating && !hovered && visible;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActive(index => (index + 1) % SLIDES.length), 6500);
    return () => window.clearInterval(timer);
  }, [playing]);

  const slide = SLIDES[active]!;
  const text = copy[slide.key];
  return (
    <section data-brand-auth-showcase data-playing={playing} className={styles.showcase}
      aria-label={copy.showcaseLabel}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={event => {
        // Keyboard focus stops rotation until the reader explicitly starts it again.
        if (event.target.matches(':focus-visible') && !event.currentTarget.contains(event.relatedTarget as Node | null)) setRotating(false);
      }}>
      <div className={styles.picture}>
        {failedImages.includes(slide.image) ? <p className={styles.imageFallback}>{copy.unavailable}</p> : (
          // Public, already published campaign media. No client identities or fabricated results.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={slide.image} src={`${assetOrigin}/reel/campaigns/${slide.image}`} alt={text.alt}
            width={active === 0 ? 720 : 1280} height={active === 0 ? 1282 : 720}
            fetchPriority={active === 0 ? 'high' : 'auto'} decoding="async"
            onError={() => setFailedImages(previous => [...previous, slide.image])} />
        )}
        <span className={styles.example}>{copy.example}</span>
        <span className={styles.counter} aria-hidden="true">0{active + 1} / 03</span>
      </div>
      <div className={styles.caption} aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <div className={styles.controls}>
        <div className={styles.choices}>
          {SLIDES.map((item, index) => (
            <button key={item.key} type="button" aria-pressed={active === index}
              onClick={() => { setRotating(false); setActive(index); }}>
              <span aria-hidden="true">0{index + 1}</span>{copy[item.key].label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.play} aria-label={rotating ? copy.pause : copy.play}
          onClick={() => setRotating(value => !value)}>
          {rotating ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" /></svg>
            : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z" fill="currentColor" /></svg>}
        </button>
      </div>
    </section>
  );
}
