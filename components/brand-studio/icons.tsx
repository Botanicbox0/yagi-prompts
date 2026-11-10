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
} as const;

export type StudioIconName = keyof typeof paths;

export function StudioIcon({ name }: { name: StudioIconName }) {
  return (
    <svg className="bs-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
