import { useCurrentFrame } from 'remotion';

// Film grain: fresh turbulence every frame (seed = frame). Screen-blended at low opacity so it
// lifts the blacks the way stock does instead of dirtying the cream ink.
export const Grain = ({ opacity = 0.075 }: { opacity?: number }) => {
  const frame = useCurrentFrame();
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, opacity, mixBlendMode: 'screen', pointerEvents: 'none' }}
    >
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="table" tableValues="0 0 0.35 1" />
        </feComponentTransfer>
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" fill="#000" />
    </svg>
  );
};
