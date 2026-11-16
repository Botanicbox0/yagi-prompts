/** The rail's line icons, inline (no icon library). Decorative: always aria-hidden. */
const paths = {
  folder: "M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z",
  heart: "M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z",
  upload: "M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  back: "M14.5 6 8.5 12l6 6",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  plus: "M12 5.5v13M5.5 12h13",
  open: "M14 5h5v5M19 5l-6.5 6.5M10 19H5v-5M5 19l6.5-6.5",
  collapse: "M9.5 6 15.5 12l-6 6",
  expand: "M14.5 6 8.5 12l6 6",
  remove: "M6 12h12",
  wave: "M4 12h1.5M7 9v6M10 6v12M13 8.5v7M16 10.5v3M19 12h1",
  search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15.5 15.5 20 20",
  doc: "M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 12h6M9.5 15h6M9.5 18h4",
} as const;

export type RailIconName = keyof typeof paths;

export function RailIcon({ name, filled = false }: { name: RailIconName; filled?: boolean }) {
  return (
    <svg className="bsr-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled={filled ? "" : undefined}>
      <path d={paths[name]} />
    </svg>
  );
}
