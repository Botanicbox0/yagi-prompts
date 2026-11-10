/** The few line icons the studio needs, inline (no icon library). Decorative: always aria-hidden. */
const paths = {
  close: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  prev: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  play: "M8 5v14l11-7z",
  folder: "M3 7h6l2 2h10v10H3z",
  "folder-plus": "M3 7h6l2 2h10v10H3zM12 12v5M9.5 14.5h5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M7 10l5 5 5-5",
  region: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9z",
  rerun: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5",
  video: "M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5",
  attach: "M4 4h16v16H4zM12 8v8M8 12h8",
  save: "M6 4h12v16l-6-4-6 4z",
  send: "M21 3L3 10.5l7.5 3L14 21z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  trash: "M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  sparkles: "M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  layers: "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  review: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  reuse: "M4 7h11M4 12h7M4 17h9M17 10v8M14 15l3 3 3-3",
  undo: "M9 6L4 11l5 5M4 11h9a6 6 0 0 1 6 6v2",
  check: "M5 12.5l4.5 4.5L19 7",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  open: "M14 4h6v6M20 4l-8 8M18 14v6H4V6h6",
} as const;

export type StudioIconName = keyof typeof paths;

export function StudioIcon({ name, filled = false }: { name: StudioIconName; filled?: boolean }) {
  return (
    <svg className="bs-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled={filled ? "" : undefined}>
      <path d={paths[name]} />
    </svg>
  );
}
