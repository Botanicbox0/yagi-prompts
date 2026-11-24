'use client';

import type { TemplateLook } from '@/lib/template-look/look';
import { useViewerLook } from './use-viewer-look';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — on a template written for one style, one quiet line above the make button when the
 * viewer picked the other one. Never a block: a shared link or a search still opens the template and the button stays
 * exactly as it was. Rendered only with the switch on; the server markup is empty (the page is the same cached HTML
 * for everyone).
 */
export function LookMismatch({ template, note, className = '' }: { template: TemplateLook; note: string; className?: string }) {
  const viewer = useViewerLook(true);
  if (!viewer || viewer.look === null || viewer.look === template) return null;
  return (
    <p data-look-mismatch={template} className={`text-xs leading-relaxed text-[#52525B] break-keep ${className}`.trim()}>
      {note}
    </p>
  );
}
