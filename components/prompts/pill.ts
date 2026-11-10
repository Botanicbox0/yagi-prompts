/**
 * docs/PLATFORM-2.0.md §15.3-5 — one selected-state style for the catalog's controls. The medium
 * segment (영상 · 이미지) was a square outlined tab and the use-case filter a pill; both are now this
 * pill, so "selected" looks the same wherever the reader meets it.
 */
const BASE =
  'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-200';

export function pillClassName(on: boolean): string {
  // Selected is the ink fill, unselected a white chip with the line (components/brand-studio/v7.module.css `.chip`).
  return `${BASE} ${on ? 'border-transparent bg-black text-white' : 'border-hairline bg-white hover:border-black/40'}`;
}
