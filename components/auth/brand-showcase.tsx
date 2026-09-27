'use client';

import { useEffect, useRef, useState } from 'react';
import type { getDictionary } from '@/lib/i18n/dictionaries';
import styles from './brand-entry.module.css';

type Copy = ReturnType<typeof getDictionary>['auth']['brandEntry'];
const SLIDES = [
  { key: 'request', image: 'retro-phone-01.jpg' },
  { key: 'review', image: 'highteen.jpg' },
  { key: 'report', image: 'beauty-rose.jpg' },
] as const;
const FASHION_VIDEO = 'https://nhokkikjkzjalxqsbzuk.supabase.co/storage/v1/object/public/public-content/363fcfa1538c10fc5022cee15cf91c72271f3c0bbc254b68fea9842dd79d6c56.mp4';
const FASHION_POSTER = 'https://nhokkikjkzjalxqsbzuk.supabase.co/storage/v1/object/public/public-content/5b93de5eb4050613fcfcfb26f0239199c0182c5dd614a20495576ada9b122126.jpg';

/** Auth stays server-rendered; this island only changes the public showcase. */
export function BrandShowcase({ copy, assetOrigin }: { copy: Copy; assetOrigin: string }) {
  const [active, setActive] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRotating(!preference.matches);
    setMotionAllowed(!preference.matches);
    const stopForReducedMotion = () => {
      setMotionAllowed(!preference.matches);
      if (preference.matches) setRotating(false);
    };
    const updateVisibility = () => setVisible(!document.hidden);
    updateVisibility();
    preference.addEventListener('change', stopForReducedMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', stopForReducedMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!video.current) return;
    if (motionAllowed && visible) void video.current.play().catch(() => {});
    else video.current.pause();
  }, [active, motionAllowed, visible]);

  const playing = rotating && !hovered && visible;
  useEffect(() => {
    if (!playing) return;
    // Let the full 13-second film finish before rotating to the next example.
    const timer = window.setTimeout(() => setActive(index => (index + 1) % SLIDES.length), active === 0 ? 14500 : 6500);
    return () => window.clearTimeout(timer);
  }, [playing, active]);

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
      <div className={styles.picture} data-format="landscape">
        {active === 0 ? (
          <video ref={video} src={FASHION_VIDEO} poster={FASHION_POSTER}
            width={1440} height={1080} muted loop playsInline controls preload="metadata"
            aria-label={text.alt} onClick={() => setRotating(false)} />
        ) : failedImages.includes(slide.image) ? <p className={styles.imageFallback}>{copy.unavailable}</p> : (
          // Public, already published campaign media. No client identities or fabricated results.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={slide.image} src={`${assetOrigin}/reel/campaigns/${slide.image}`} alt={text.alt}
            width={1280} height={720} decoding="async"
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
