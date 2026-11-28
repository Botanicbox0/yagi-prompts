/** Line icons for the editing studio v2 prototype, inline and decorative (always aria-hidden). */
const paths = {
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  toStart: 'M6 5v14M19 5l-9 7 9 7z',
  split: 'M12 3v18M5 8l4 4-4 4M19 8l-4 4 4 4',
  undo: 'M9 6L4 11l5 5M4 11h9a6 6 0 0 1 6 6v2',
  redo: 'M15 6l5 5-5 5M20 11h-9a6 6 0 0 0-6 6v2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13',
  check: 'M5 12.5l4.5 4.5L19 7',
  send: 'M5 12h14M13 6l6 6-6 6',
  compare: 'M4 5h16v14H4zM12 3v18',
  dock: 'M4 5h16v14H4zM15 5v14',
  bar: 'M4 5h16v14H4zM4 15h16',
  close: 'M6 6l12 12M18 6L6 18',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  review: 'M4 5h16v11H9l-5 4z',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M7 10l5 5 5-5',
  forward: 'M9 5l7 7-7 7',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4M6 4h4v8a2 2 0 0 0 4 0V4h4M6 8h4M14 8h4',
  link: 'M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.5-1.5',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
} as const;

export type EditorIconName = keyof typeof paths;

export function EditorIcon({ name }: { name: EditorIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill={name === 'play' ? 'currentColor' : 'none'} />
    </svg>
  );
}
