'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The main colour of the first picture or video inside, read from a 16×16 sample, spread softly
 * behind the content (workspace.css `.bw-bleed`). Same-origin media only: a tainted canvas or an
 * unreadable frame simply leaves the page without the glow. The chrome around it stays neutral.
 */
export function AmbientBleed({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const media = root?.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
    if (!root || !media) return;
    /** True once a colour was set; false when the frame was not readable yet (blank or tainted). */
    const sample = (source: CanvasImageSource): boolean => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return false;
        context.drawImage(source, 0, 0, 16, 16);
        const { data } = context.getImageData(0, 0, 16, 16);
        // Weight saturated, mid-light pixels: the subject's colour rather than a white wall or shadow.
        let r = 0, g = 0, b = 0, total = 0, brightest = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb] = [data[i]!, data[i + 1]!, data[i + 2]!];
          const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
          const light = (max + min) / 510;
          const weight = 0.15 + (max - min) / 255 * (1 - Math.abs(light - 0.55));
          r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
          brightest = Math.max(brightest, max);
        }
        // An undecoded frame reads as all black: no glow rather than a grey one.
        if (!total || brightest < 24) return false;
        const hex = [r, g, b].map(v => Math.round(v / total).toString(16).padStart(2, '0')).join('');
        root.style.setProperty('--bw-bleed', `#${hex}`);
        root.dataset.bleed = '';
        return true;
      } catch {
        return false; // Cross-origin: no glow.
      }
    };
    if (media instanceof HTMLVideoElement) {
      // The visible player may not have a readable frame while paused, so a muted copy seeks to about a
      // second in (past a fade from black) and is read there. Same file, usually from the HTTP cache.
      const src = media.currentSrc || media.src;
      if (!src) return;
      const copy = document.createElement('video');
      copy.muted = true;
      copy.preload = 'auto';
      copy.playsInline = true;
      const seek = () => { copy.currentTime = Math.min(1, (copy.duration || 4) / 4); };
      const read = () => { sample(copy); copy.removeAttribute('src'); copy.load(); };
      copy.addEventListener('loadeddata', seek, { once: true });
      copy.addEventListener('seeked', read, { once: true });
      copy.src = src;
      return () => { copy.removeEventListener('loadeddata', seek); copy.removeEventListener('seeked', read); copy.removeAttribute('src'); };
    }
    const image = media;
    const fromImage = () => { sample(image); };
    if (image.complete && image.naturalWidth) fromImage();
    else image.addEventListener('load', fromImage, { once: true });
    return () => image.removeEventListener('load', fromImage);
  }, []);
  return <div ref={ref} className={['bw-bleed', className].filter(Boolean).join(' ')}>{children}</div>;
}
