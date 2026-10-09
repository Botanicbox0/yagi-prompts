'use client';

import { useEffect } from 'react';
import { adminNavScrollLeft } from '@/lib/admin/nav-scroll';

/** Progressive enhancement only: the server still owns every navigation link. */
export function AdminNavigationScroll({ active }: { active: string }) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('[data-admin-navigation]');
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !item) return;
    let disposed = false;
    const reveal = () => {
      if (disposed || !window.matchMedia('(max-width: 899px)').matches) return;
      const container = nav.getBoundingClientRect(), current = item.getBoundingClientRect();
      const origin = container.left + nav.clientLeft;
      nav.scrollLeft = adminNavScrollLeft({
        scrollLeft: nav.scrollLeft, clientWidth: nav.clientWidth, scrollWidth: nav.scrollWidth,
        itemLeft: current.left - origin + nav.scrollLeft, itemRight: current.right - origin + nav.scrollLeft,
      });
    };
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(nav);
    observer?.observe(item);
    window.addEventListener('resize', reveal);
    // A late font can shift preceding labels without changing the active label's own width.
    void document.fonts?.ready.then(reveal);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener('resize', reveal); };
  }, [active]);
  return null;
}
