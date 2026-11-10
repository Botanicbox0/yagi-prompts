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
} as const;

export type StudioIconName = keyof typeof paths;

export function StudioIcon({ name }: { name: StudioIconName }) {
  return (
    <svg className="bs-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
