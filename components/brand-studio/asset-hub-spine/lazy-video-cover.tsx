"use client";
/**
 * Viewport-gated metadata video frame cover for `ByProjectView` (§5.3, Fix 4-1).
 * Renders a neutral dark placeholder block on SSR / initial mount and mounts one bounded
 * non-autoplaying `preload="metadata"` `<video src="...#t=0.1">` once within 200px of the
 * viewport via `IntersectionObserver`, disconnecting on first hit and unmount.
 */
import { useEffect, useRef, useState } from "react";

export function LazyVideoCover({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <span ref={hostRef} className={className} aria-hidden="true">
      {visible && (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
