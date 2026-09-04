import { AbsoluteFill, interpolate, random } from 'remotion';
import { CREAM } from './palette';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** A few faint motes drifting past the camera with parallax — the only thing that says "space". */
export const Dust = ({ progress, width, height }: { progress: number; width: number; height: number }) => {
  const motes = Array.from({ length: 40 }, (_, i) => {
    const angle = random(`a${i}`) * Math.PI * 2;
    const r0 = 0.06 + random(`r${i}`) * 0.4;
    const depth = 0.3 + random(`d${i}`) * 0.7; // nearer motes fly past faster and brighter
    const r = r0 * (1 + 3.2 * progress * depth);
    const x = 0.5 + Math.cos(angle) * r;
    const y = 0.5 + Math.sin(angle) * r * (width / height);
    const edge = Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) * 2;
    const opacity = (0.1 + 0.26 * depth) * interpolate(edge, [0.7, 1.05], [1, 0], clamp);
    return { x, y, size: (1 + depth * 1.6) * (height / 1080), opacity };
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {motes.map((m, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: m.x * width,
            top: m.y * height,
            width: m.size,
            height: m.size,
            borderRadius: '50%',
            background: CREAM,
            opacity: m.opacity,
            filter: 'blur(0.4px)',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

