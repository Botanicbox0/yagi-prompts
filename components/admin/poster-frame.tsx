'use client';

import { useEffect, useRef, useState } from 'react';

type PosterShape = 'landscape' | 'portrait';

function shapeOf(w: number, h: number): PosterShape {
  return w >= h ? 'landscape' : 'portrait';
}

/** What is known before the image loads: its measured size, then the template's opening aspect. */
function initialShape(w: number | undefined, h: number | undefined, aspect: string | null): PosterShape {
  if (w && h) return shapeOf(w, h);
  const match = aspect ? /^(\d+):(\d+)$/.exec(aspect) : null;
  return match ? shapeOf(Number(match[1]), Number(match[2])) : 'landscape';
}

/**
 * Staff report (2026-11-02): the admin wall letterboxed every poster into a black 16:9 box. A poster
 * now fills a 16:9 or a 9:16 frame, whichever matches its shape. Most single uploads carry no measured
 * size and a template's aspect can differ from its poster, so the loaded image has the last word.
 */
export function AdminPosterFrame({ src, w, h, aspect }: { src: string; w?: number; h?: number; aspect: string | null }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [shape, setShape] = useState<PosterShape>(() => initialShape(w, h, aspect));

  const measure = () => {
    const image = imageRef.current;
    if (image?.naturalWidth && image.naturalHeight) setShape(shapeOf(image.naturalWidth, image.naturalHeight));
  };

  // A cached image can finish loading before hydration, when `onLoad` is not listening yet.
  useEffect(() => {
    if (imageRef.current?.complete) measure();
  }, []);

  return (
    <div data-poster-frame={shape} className={`overflow-hidden ${shape === 'landscape' ? 'aspect-video' : 'aspect-[9/16]'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- staging object behind the gate */}
      <img ref={imageRef} src={src} alt="" onLoad={measure} className="h-full w-full object-cover" />
    </div>
  );
}
