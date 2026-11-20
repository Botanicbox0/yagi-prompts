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
} as const;

export type EditorIconName = keyof typeof paths;

export function EditorIcon({ name }: { name: EditorIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill={name === 'play' ? 'currentColor' : 'none'} />
    </svg>
  );
}
