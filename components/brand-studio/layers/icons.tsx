/** Line icons for the layer editor (24 grid, 1.8 stroke, currentColor). Decorative: labels live on the buttons. */
const PATHS = {
  close: "M6 6l12 12M18 6L6 18",
  undo: "M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2",
  redo: "M15 7l5 5-5 5M20 12H9a5 5 0 000 10h2",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  actual: "M7 9l2-1v8M14 9l2-1v8M11.5 11v.01M11.5 14v.01",
  text: "M5 6V5h14v1M12 5v14M9 19h6",
  rect: "M4.5 6.5h15v11h-15z",
  ellipse: "M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5-8-2.9-8-6.5 3.6-6.5 8-6.5z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5v.01",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z",
  eyeOff: "M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1C18 5.9 21.5 12 21.5 12a17 17 0 01-3 3.7M6.6 6.7A17 17 0 002.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1.1M9.9 10a2.5 2.5 0 003.9 3.2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3",
  unlock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 016.8-1.2",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  layers: "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  alignLeft: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignCenter: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignRight: "M4 6h16M10 10h10M4 14h16M10 18h10",
  folder: "M3.5 6.5h6l2 2h9v10h-17z",
  back: "M15 5l-7 7 7 7",
  reset: "M4 12a8 8 0 108-8H8M8 4L5 7l3 3",
  ratio: "M5 5h14v14H5zM5 5l14 14",
  check: "M5 12.5l4.5 4.5L19 7.5",
} as const;

export type LayerIconName = keyof typeof PATHS;

export function LayerIcon({ name }: { name: LayerIconName }) {
  return (
    <svg className="bsl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
