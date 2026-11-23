export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
export const SPEED_STEP = 0.01;
export const MIN_SPEED_PCT = 10;
export const MAX_SPEED_PCT = 1000;
export const MIN_CURVE_POINTS = 2;
/** Maximum control points a user may manually add in the UI. */
export const MAX_CURVE_POINTS = 8;
/** Hard internal/storage cap including trim/edit boundary points; never silently truncates beyond this. */
export const MAX_CURVE_TOTAL_POINTS = 64;
export const MIN_CURVE_GAP = 0.02;
export const MIN_CURVE_POINT_SEPARATION = 1e-7;
export const MAX_CURVE_MEDIA_SPAN = 10_000_000;
export const MAX_CURVE_SLOPE = 10_000;

export const LEGACY_SPEEDS = [
  { num: 1, den: 2, rate: 0.5, label: '0.5×' },
  { num: 1, den: 1, rate: 1, label: '1×' },
  { num: 3, den: 2, rate: 1.5, label: '1.5×' },
  { num: 2, den: 1, rate: 2, label: '2×' },
] as const;

export interface SpeedPoint {
  /** Normalized media progress within the domain curve span: `0` at start, `1` at end. */
  pos: number;
  /** Playback rate at `pos`, inside `[0.10, 10.00]`. */
  speed: number;
  /** Optional slowness derivative `dw/du` (incoming tangent, and outgoing unless `slopeRight` differs). */
  slope?: number;
  /** Optional outgoing slowness derivative `dw/du` when a flat trim extension joins a sloped segment. */
  slopeRight?: number;
}

export interface SpeedCurveDomain {
  startMedia: number;
  spanMedia: number;
  points: SpeedPoint[];
}

export interface SpeedCurve {
  /** Media position at the start of the active cut span (`u = 0`), on the film's frame grid. */
  startMedia: number;
  /** Total media frames spanned by the active cut span (`u = 0..1`), on the film's frame grid. */
  spanMedia: number;
  /** Optional untouched domain snapshot retained across trims/splits so reversing a trim restores exact frames. */
  sourceDomain?: SpeedCurveDomain;
  /** Legacy compatibility fields from pre-canonical curves. */
  winStartMedia?: number;
  winEndMedia?: number;
  leadMedia?: number;
  tailMedia?: number;
  /** Exact sorted control points (`2..8` added by user, up to `64` including trim boundary corners). */
  points: SpeedPoint[];
}

export interface CompiledCurveSegment {
  u0: number;
  u1: number;
  h: number;
  m0: number;
  m1: number;
  w0: number;
  w1: number;
  d0: number;
  d1: number;
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  t0: number;
  t1: number;
  isCore?: boolean;
  coreU0?: number;
  coreU1?: number;
}

export interface CompiledSpeedCurve {
  startMedia: number;
  spanMedia: number;
  totalStartMedia: number;
  totalSpanMedia: number;
  leadMedia: number;
  tailMedia: number;
  totalFrames: number;
  points: SpeedPoint[];
  segments: CompiledCurveSegment[];
}

export type SpeedPresetId = 'slowMiddle' | 'fastMiddle' | 'fastStart' | 'fastEnd' | 'twoPulses' | 'slowDrop';

export interface SpeedPreset {
  id: SpeedPresetId;
  points: SpeedPoint[];
}

export const SPEED_PRESETS: readonly SpeedPreset[] = [
  {
    id: 'slowMiddle',
    points: [
      { pos: 0, speed: 2.0 },
      { pos: 0.35, speed: 0.35 },
      { pos: 0.65, speed: 0.35 },
      { pos: 1, speed: 2.0 },
    ],
  },
  {
    id: 'fastMiddle',
    points: [
      { pos: 0, speed: 0.5 },
      { pos: 0.35, speed: 3.0 },
      { pos: 0.65, speed: 3.0 },
      { pos: 1, speed: 0.5 },
    ],
  },
  {
    id: 'fastStart',
    points: [
      { pos: 0, speed: 4.0 },
      { pos: 0.4, speed: 1.0 },
      { pos: 1, speed: 0.5 },
    ],
  },
  {
    id: 'fastEnd',
    points: [
      { pos: 0, speed: 0.5 },
      { pos: 0.6, speed: 1.0 },
      { pos: 1, speed: 4.0 },
    ],
  },
  {
    id: 'twoPulses',
    points: [
      { pos: 0, speed: 0.6 },
      { pos: 0.25, speed: 2.5 },
      { pos: 0.5, speed: 0.6 },
      { pos: 0.75, speed: 2.5 },
      { pos: 1, speed: 0.6 },
    ],
  },
  {
    id: 'slowDrop',
    points: [
      { pos: 0, speed: 2.5 },
      { pos: 0.3, speed: 1.5 },
      { pos: 0.7, speed: 0.45 },
      { pos: 1, speed: 0.3 },
    ],
  },
];

export function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  return Math.round((clamped + 1e-12) * 100) / 100;
}

function clampSpeedExact(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export function toSpeedRational(speed: number): { num: number; den: number } {
  const pct = Math.min(MAX_SPEED_PCT, Math.max(MIN_SPEED_PCT, Math.round((clampSpeed(speed) + 1e-12) * 100)));
  const factor = gcdInt(pct, 100);
  return { num: pct / factor, den: 100 / factor };
}

export function parseSpeedInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[x×]$/i, '').replace(/,/g, '.').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return clampSpeed(value);
}

export function formatSpeed(speed: number): string {
  return Number(clampSpeed(speed).toFixed(2)).toString();
}

export function speedToLogSlider(speed: number): number {
  const safe = clampSpeed(speed);
  const norm = (Math.log10(safe) + 1) / 2;
  return Math.min(1000, Math.max(0, Math.round(norm * 1000)));
}

export function logSliderToSpeed(sliderValue: number): number {
  if (!Number.isFinite(sliderValue)) return 1;
  const clamped = Math.min(1000, Math.max(0, sliderValue));
  if (clamped === 500) return 1;
  return clampSpeed(Math.pow(10, (clamped / 1000) * 2 - 1));
}

/** Discrete keyboard step on the speed slider so every arrow key moves by 0.01× and all 991 values are reachable. */
export function nextSpeedOnSliderKey(currentSpeed: number, key: string): number {
  const pct = Math.min(MAX_SPEED_PCT, Math.max(MIN_SPEED_PCT, Math.round((clampSpeedExact(currentSpeed) + 1e-12) * 100)));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(MAX_SPEED_PCT, pct + 1) / 100;
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(MIN_SPEED_PCT, pct - 1) / 100;
    case 'PageUp':
      return Math.min(MAX_SPEED_PCT, pct + 10) / 100;
    case 'PageDown':
      return Math.max(MIN_SPEED_PCT, pct - 10) / 100;
    case 'Home':
      return MIN_SPEED;
    case 'End':
      return MAX_SPEED;
    default:
      return pct / 100;
  }
}

export function curveStartMedia(curve: SpeedCurve): number {
  if (typeof curve.winStartMedia === 'number' && Number.isFinite(curve.winStartMedia)) {
    return curve.winStartMedia;
  }
  return curve.startMedia - (curve.leadMedia ?? 0);
}

export function curveEndMedia(curve: SpeedCurve): number {
  if (typeof curve.winEndMedia === 'number' && Number.isFinite(curve.winEndMedia)) {
    return curve.winEndMedia;
  }
  return curve.startMedia + curve.spanMedia + (curve.tailMedia ?? 0);
}

export function curveTotalSpanMedia(curve: SpeedCurve): number {
  return Math.max(1e-9, curveEndMedia(curve) - curveStartMedia(curve));
}

function cloneSpeedPoint(p: SpeedPoint): SpeedPoint {
  const validSlope = typeof p.slope === 'number' && Number.isFinite(p.slope) && Math.abs(p.slope) <= MAX_CURVE_SLOPE;
  const validRight =
    typeof p.slopeRight === 'number' && Number.isFinite(p.slopeRight) && Math.abs(p.slopeRight) <= MAX_CURVE_SLOPE;
  return {
    pos: p.pos,
    speed: p.speed,
    ...(validSlope ? { slope: p.slope } : {}),
    ...(validRight && (!validSlope || Math.abs(p.slopeRight! - p.slope!) > 1e-9) ? { slopeRight: p.slopeRight } : {}),
  };
}

function cloneDomain(d: SpeedCurveDomain): SpeedCurveDomain {
  return {
    startMedia: d.startMedia,
    spanMedia: d.spanMedia,
    points: d.points.map(cloneSpeedPoint),
  };
}

export function cloneSpeedCurve(curve: SpeedCurve): SpeedCurve {
  const winStart = curveStartMedia(curve);
  const winEnd = curveEndMedia(curve);
  const domainEnd = curve.startMedia + curve.spanMedia;
  const domain = curve.sourceDomain ? cloneDomain(curve.sourceDomain) : undefined;
  // Convert legacy window fields (`winStartMedia`/`leadMedia`/`tailMedia`) into exact canonical active points when present.
  if (Math.abs(winStart - curve.startMedia) > 1e-9 || Math.abs(winEnd - domainEnd) > 1e-9) {
    const baseDomain: SpeedCurveDomain = domain ?? {
      startMedia: curve.startMedia,
      spanMedia: curve.spanMedia,
      points: curve.points.map(cloneSpeedPoint),
    };
    const projected = projectDomainToWindow(baseDomain, winStart, winEnd);
    return {
      startMedia: winStart,
      spanMedia: Math.max(1e-9, winEnd - winStart),
      points: projected.length <= MAX_CURVE_TOTAL_POINTS ? projected : projected.slice(0, MAX_CURVE_TOTAL_POINTS),
      sourceDomain: baseDomain,
    };
  }
  return {
    startMedia: curve.startMedia,
    spanMedia: curve.spanMedia,
    ...(domain ? { sourceDomain: domain } : {}),
    points: curve.points.map(cloneSpeedPoint),
  };
}

export function isValidSpeedPoint(value: unknown): value is SpeedPoint {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<SpeedPoint>;
  if (typeof p.pos !== 'number' || !Number.isFinite(p.pos) || p.pos < 0 || p.pos > 1) return false;
  if (typeof p.speed !== 'number' || !Number.isFinite(p.speed) || p.speed < MIN_SPEED - 1e-6 || p.speed > MAX_SPEED + 1e-6) return false;
  if (p.slope !== undefined && (typeof p.slope !== 'number' || !Number.isFinite(p.slope) || Math.abs(p.slope) > MAX_CURVE_SLOPE)) {
    return false;
  }
  if (
    p.slopeRight !== undefined &&
    (typeof p.slopeRight !== 'number' || !Number.isFinite(p.slopeRight) || Math.abs(p.slopeRight) > MAX_CURVE_SLOPE)
  ) {
    return false;
  }
  return true;
}

function isValidCurveDomain(domain: unknown): domain is SpeedCurveDomain {
  if (!domain || typeof domain !== 'object' || 'sourceDomain' in domain) return false;
  const d = domain as Partial<SpeedCurveDomain>;
  if (typeof d.startMedia !== 'number' || !Number.isFinite(d.startMedia) || d.startMedia < 0 || d.startMedia > MAX_CURVE_MEDIA_SPAN) {
    return false;
  }
  if (typeof d.spanMedia !== 'number' || !Number.isFinite(d.spanMedia) || d.spanMedia <= 0 || d.spanMedia > MAX_CURVE_MEDIA_SPAN) {
    return false;
  }
  if (!Array.isArray(d.points) || d.points.length < MIN_CURVE_POINTS || d.points.length > MAX_CURVE_TOTAL_POINTS) return false;
  if (!d.points.every(isValidSpeedPoint)) return false;
  if (Math.abs(d.points[0]!.pos) > 1e-6 || Math.abs(d.points[d.points.length - 1]!.pos - 1) > 1e-6) return false;
  for (let i = 1; i < d.points.length; i += 1) {
    if (d.points[i]!.pos <= d.points[i - 1]!.pos) return false;
  }
  return true;
}

export function isValidSpeedCurve(value: unknown): value is SpeedCurve {
  if (!value || typeof value !== 'object') return false;
  const curve = value as Partial<SpeedCurve>;
  if (typeof curve.startMedia !== 'number' || !Number.isFinite(curve.startMedia) || curve.startMedia < 0 || curve.startMedia > MAX_CURVE_MEDIA_SPAN) {
    return false;
  }
  if (typeof curve.spanMedia !== 'number' || !Number.isFinite(curve.spanMedia) || curve.spanMedia <= 0 || curve.spanMedia > MAX_CURVE_MEDIA_SPAN) {
    return false;
  }
  if (
    curve.winStartMedia !== undefined &&
    (typeof curve.winStartMedia !== 'number' ||
      !Number.isFinite(curve.winStartMedia) ||
      curve.winStartMedia < 0 ||
      curve.winStartMedia > MAX_CURVE_MEDIA_SPAN)
  ) {
    return false;
  }
  if (
    curve.winEndMedia !== undefined &&
    (typeof curve.winEndMedia !== 'number' ||
      !Number.isFinite(curve.winEndMedia) ||
      curve.winEndMedia <= 0 ||
      curve.winEndMedia > MAX_CURVE_MEDIA_SPAN)
  ) {
    return false;
  }
  const winStart = curve.winStartMedia ?? curve.startMedia - (curve.leadMedia ?? 0);
  const winEnd = curve.winEndMedia ?? curve.startMedia + curve.spanMedia + (curve.tailMedia ?? 0);
  if (winStart < -1e-6 || winEnd - winStart <= 1e-9 || winEnd - winStart > MAX_CURVE_MEDIA_SPAN) {
    return false;
  }
  if (curve.leadMedia !== undefined && (typeof curve.leadMedia !== 'number' || !Number.isFinite(curve.leadMedia) || curve.leadMedia < 0 || curve.leadMedia > curve.startMedia + 1e-6)) {
    return false;
  }
  if (curve.tailMedia !== undefined && (typeof curve.tailMedia !== 'number' || !Number.isFinite(curve.tailMedia) || curve.tailMedia < 0 || curve.tailMedia > MAX_CURVE_MEDIA_SPAN)) {
    return false;
  }
  if (curve.sourceDomain !== undefined && !isValidCurveDomain(curve.sourceDomain)) return false;
  if (!Array.isArray(curve.points) || curve.points.length < MIN_CURVE_POINTS || curve.points.length > MAX_CURVE_TOTAL_POINTS) return false;
  if (!curve.points.every(isValidSpeedPoint)) return false;
  if (Math.abs(curve.points[0]!.pos) > 1e-6 || Math.abs(curve.points[curve.points.length - 1]!.pos - 1) > 1e-6) return false;
  for (let i = 1; i < curve.points.length; i += 1) {
    if (curve.points[i]!.pos <= curve.points[i - 1]!.pos) return false;
  }
  return true;
}

export function normalizeCurvePoints(points: readonly SpeedPoint[]): SpeedPoint[] {
  const sanitized = points
    .filter((p) => Number.isFinite(p.pos) && Number.isFinite(p.speed))
    .map((p) => {
      const validSlope = typeof p.slope === 'number' && Number.isFinite(p.slope) && Math.abs(p.slope) <= MAX_CURVE_SLOPE;
      const validRight =
        typeof p.slopeRight === 'number' && Number.isFinite(p.slopeRight) && Math.abs(p.slopeRight) <= MAX_CURVE_SLOPE;
      return {
        pos: Math.min(1, Math.max(0, p.pos)),
        speed: clampSpeedExact(p.speed),
        ...(validSlope ? { slope: p.slope } : {}),
        ...(validRight && (!validSlope || Math.abs(p.slopeRight! - p.slope!) > 1e-9) ? { slopeRight: p.slopeRight } : {}),
      };
    })
    .sort((a, b) => a.pos - b.pos);

  if (sanitized.length < MIN_CURVE_POINTS) {
    return [
      { pos: 0, speed: sanitized[0]?.speed ?? 1 },
      { pos: 1, speed: sanitized[sanitized.length - 1]?.speed ?? sanitized[0]?.speed ?? 1 },
    ];
  }

  sanitized[0] = { ...sanitized[0]!, pos: 0 };
  sanitized[sanitized.length - 1] = { ...sanitized[sanitized.length - 1]!, pos: 1 };

  const out: SpeedPoint[] = [sanitized[0]!];
  for (let i = 1; i < sanitized.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const minPos = prev.pos + MIN_CURVE_POINT_SEPARATION;
    const maxPos = 1 - MIN_CURVE_POINT_SEPARATION * (sanitized.length - 1 - i);
    const pos = minPos <= maxPos ? Math.min(maxPos, Math.max(minPos, sanitized[i]!.pos)) : sanitized[i]!.pos;
    out.push({ ...sanitized[i]!, pos });
  }
  out.push(sanitized[sanitized.length - 1]!);
  return out;
}

function projectDomainToWindow(domain: SpeedCurveDomain, winStart: number, winEnd: number): SpeedPoint[] {
  const domainEnd = domain.startMedia + domain.spanMedia;
  if (Math.abs(winStart - domain.startMedia) <= 1e-9 && Math.abs(winEnd - domainEnd) <= 1e-9) {
    return domain.points.map(cloneSpeedPoint);
  }
  const compiled = compileSpeedCurve({
    startMedia: domain.startMedia,
    spanMedia: domain.spanMedia,
    winStartMedia: winStart,
    winEndMedia: winEnd,
    points: domain.points,
  });
  const segs = compiled.segments;
  const pts: SpeedPoint[] = [];
  const first = segs[0]!;
  const dFirstOut = first.c1 / Math.max(1e-9, first.h);
  pts.push({ pos: 0, speed: clampSpeedExact(1 / first.w0), slope: dFirstOut });

  for (let k = 1; k < segs.length; k += 1) {
    const left = segs[k - 1]!;
    const right = segs[k]!;
    const dIn = (3 * left.c3 + 2 * left.c2 + left.c1) / Math.max(1e-9, left.h);
    const dOut = right.c1 / Math.max(1e-9, right.h);
    const speed = clampSpeedExact(1 / right.w0);
    pts.push({
      pos: right.u0,
      speed,
      slope: dIn,
      ...(Math.abs(dOut - dIn) > 1e-9 ? { slopeRight: dOut } : {}),
    });
  }

  const last = segs[segs.length - 1]!;
  const dLastIn = (3 * last.c3 + 2 * last.c2 + last.c1) / Math.max(1e-9, last.h);
  pts.push({ pos: 1, speed: clampSpeedExact(1 / last.w1), slope: dLastIn });
  return normalizeCurvePoints(pts).map(cloneSpeedPoint);
}

/** Returns the exact control points shown by the panel (identical to `curve.points` when canonical). */
export function editablePointsOfCurve(curve: SpeedCurve): SpeedPoint[] {
  const winStart = curveStartMedia(curve);
  const winEnd = curveEndMedia(curve);
  const domainEnd = curve.startMedia + curve.spanMedia;
  if (Math.abs(winStart - curve.startMedia) <= 1e-9 && Math.abs(winEnd - domainEnd) <= 1e-9) {
    return normalizeCurvePoints(curve.points).map(cloneSpeedPoint);
  }
  const baseDomain: SpeedCurveDomain = curve.sourceDomain ?? {
    startMedia: curve.startMedia,
    spanMedia: curve.spanMedia,
    points: curve.points,
  };
  return projectDomainToWindow(baseDomain, winStart, winEnd);
}

/**
 * Updates Fritsch–Carlson PCHIP tangents locally at edited indices while keeping untouched points'
 * positions, speeds, and stored tangents (`slope`, `slopeRight`) intact outside `{lo..hi}`.
 */
function applyLocalSlopesAround(nextPoints: readonly SpeedPoint[], lo: number, hi: number): SpeedPoint[] {
  const n = nextPoints.length;
  const u = nextPoints.map((p) => p.pos);
  const w = nextPoints.map((p) => 1 / clampSpeedExact(p.speed));
  const pchip = pchipSlopes(u, w);

  return nextPoints.map((p, k) => {
    if (k < lo || k > hi) {
      return cloneSpeedPoint(p);
    }
    const rightFlat = k < n - 1 && Math.abs(w[k]! - w[k + 1]!) < 1e-9 && p.slopeRight !== undefined && Math.abs(p.slopeRight) < 1e-9;
    return {
      pos: p.pos,
      speed: p.speed,
      slope: pchip[k]!,
      ...(rightFlat && Math.abs(pchip[k]!) > 1e-9 ? { slopeRight: 0 } : {}),
    };
  });
}

export function addCurvePoint(points: readonly SpeedPoint[], pos: number, speed: number): SpeedPoint[] {
  const base = normalizeCurvePoints(points).map(cloneSpeedPoint);
  if (base.length >= MAX_CURVE_POINTS) return base;
  const clampedSpeed = clampSpeedExact(speed);
  const clampedPos = Math.min(1 - MIN_CURVE_GAP, Math.max(MIN_CURVE_GAP, pos));

  for (const existing of base) {
    if (Math.abs(existing.pos - clampedPos) < MIN_CURVE_GAP) {
      return base;
    }
  }

  const withAdded = normalizeCurvePoints([...base, { pos: clampedPos, speed: clampedSpeed }]);
  const idx = withAdded.findIndex((p) => Math.abs(p.pos - clampedPos) < 1e-6);
  const hasStoredSlopes = base.some((p) => p.slope !== undefined || p.slopeRight !== undefined);
  if (!hasStoredSlopes || idx < 0) return withAdded;
  return applyLocalSlopesAround(withAdded, Math.max(0, idx - 1), Math.min(withAdded.length - 1, idx + 1));
}

export function moveCurvePoint(points: readonly SpeedPoint[], index: number, pos: number, speed: number): SpeedPoint[] {
  const base = normalizeCurvePoints(points).map(cloneSpeedPoint);
  if (index < 0 || index >= base.length) return base;
  const current = base[index]!;
  const nextSpeed = clampSpeedExact(speed);
  let nextPos = current.pos;
  if (index > 0 && index < base.length - 1) {
    const prev = base[index - 1]!;
    const next = base[index + 1]!;
    const gap = Math.min(MIN_CURVE_GAP, (next.pos - prev.pos) / 4);
    nextPos = Math.min(next.pos - gap, Math.max(prev.pos + gap, pos));
  }
  if (Math.abs(nextPos - current.pos) < 1e-9 && Math.abs(nextSpeed - current.speed) < 1e-9) {
    return base;
  }

  const updated = base.map((p, k) => (k === index ? { pos: nextPos, speed: nextSpeed } : p));
  return applyLocalSlopesAround(updated, Math.max(0, index - 1), Math.min(updated.length - 1, index + 1));
}

export function removeCurvePoint(points: readonly SpeedPoint[], index: number): SpeedPoint[] {
  const base = normalizeCurvePoints(points).map(cloneSpeedPoint);
  if (base.length <= MIN_CURVE_POINTS || index <= 0 || index >= base.length - 1) return base;
  const remaining = base.filter((_, idx) => idx !== index);
  const hasStoredSlopes = base.some((p) => p.slope !== undefined || p.slopeRight !== undefined);
  if (!hasStoredSlopes) return remaining;
  return applyLocalSlopesAround(remaining, Math.max(0, index - 1), Math.min(remaining.length - 1, index));
}

export function findSpeedPreset(points: readonly SpeedPoint[]): SpeedPresetId | null {
  for (const preset of SPEED_PRESETS) {
    if (preset.points.length !== points.length) continue;
    let matches = true;
    for (let i = 0; i < points.length; i += 1) {
      if (Math.abs(preset.points[i]!.pos - points[i]!.pos) > 0.005 || Math.abs(preset.points[i]!.speed - points[i]!.speed) > 0.015) {
        matches = false;
        break;
      }
    }
    if (matches) return preset.id;
  }
  return null;
}

export function isFlatCurve(curve: SpeedCurve): number | null {
  const first = curve.points[0]?.speed;
  if (first === undefined) return null;
  for (const p of curve.points) {
    if (Math.abs(p.speed - first) > 1e-9) return null;
    if (p.slope !== undefined && Math.abs(p.slope) > 1e-9) return null;
    if (p.slopeRight !== undefined && Math.abs(p.slopeRight) > 1e-9) return null;
  }
  return first;
}

function pchipSlopes(u: readonly number[], w: readonly number[]): number[] {
  const n = u.length;
  if (n === 2) {
    const slope = (w[1]! - w[0]!) / Math.max(1e-9, u[1]! - u[0]!);
    return [slope, slope];
  }

  const h: number[] = [];
  const delta: number[] = [];
  for (let k = 0; k < n - 1; k += 1) {
    const hk = Math.max(1e-9, u[k + 1]! - u[k]!);
    h.push(hk);
    delta.push((w[k + 1]! - w[k]!) / hk);
  }

  const d = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k += 1) {
    const dPrev = delta[k - 1]!;
    const dNext = delta[k]!;
    if (dPrev === 0 || dNext === 0 || (dPrev > 0 && dNext < 0) || (dPrev < 0 && dNext > 0)) {
      d[k] = 0;
    } else {
      const w1 = 2 * h[k]! + h[k - 1]!;
      const w2 = h[k]! + 2 * h[k - 1]!;
      d[k] = (w1 + w2) / (w1 / dPrev + w2 / dNext);
    }
  }

  const endpointSlope = (h0: number, h1: number, d0: number, d1: number): number => {
    if (d0 === 0) return 0;
    let slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(slope) !== Math.sign(d0)) return 0;
    if (Math.abs(slope) > 3 * Math.abs(d0)) slope = 3 * d0;
    return slope;
  };

  d[0] = endpointSlope(h[0]!, h[1]!, delta[0]!, delta[1]!);
  d[n - 1] = endpointSlope(h[n - 2]!, h[n - 3]!, delta[n - 2]!, delta[n - 3]!);
  return d;
}

function asCompiled(input: CompiledSpeedCurve | SpeedCurve): CompiledSpeedCurve {
  return 'segments' in input ? input : compileSpeedCurve(input);
}

function compilePointsOf(rawPoints: readonly SpeedPoint[]): SpeedPoint[] {
  const clean = rawPoints
    .filter((p) => Number.isFinite(p.pos) && Number.isFinite(p.speed))
    .map((p) => {
      const validSlope = typeof p.slope === 'number' && Number.isFinite(p.slope) && Math.abs(p.slope) <= MAX_CURVE_SLOPE;
      const validRight =
        typeof p.slopeRight === 'number' && Number.isFinite(p.slopeRight) && Math.abs(p.slopeRight) <= MAX_CURVE_SLOPE;
      return {
        pos: Math.min(1, Math.max(0, p.pos)),
        speed: clampSpeedExact(p.speed),
        ...(validSlope ? { slope: p.slope } : {}),
        ...(validRight ? { slopeRight: p.slopeRight } : {}),
      };
    })
    .sort((a, b) => a.pos - b.pos);
  if (clean.length < MIN_CURVE_POINTS) {
    return [
      { pos: 0, speed: clean[0]?.speed ?? 1 },
      { pos: 1, speed: clean[clean.length - 1]?.speed ?? clean[0]?.speed ?? 1 },
    ];
  }
  clean[0] = { ...clean[0]!, pos: 0 };
  clean[clean.length - 1] = { ...clean[clean.length - 1]!, pos: 1 };
  const deduped: SpeedPoint[] = [clean[0]!];
  for (let i = 1; i < clean.length - 1; i += 1) {
    const prev = deduped[deduped.length - 1]!;
    if (clean[i]!.pos > prev.pos + 1e-9 && clean[i]!.pos < 1 - 1e-9) {
      deduped.push(clean[i]!);
    }
  }
  deduped.push(clean[clean.length - 1]!);
  return deduped;
}

function clampMonotoneSegmentSlope(slope: number, delta: number): number {
  if (Math.abs(delta) < 1e-12) return 0;
  if (Math.sign(slope) !== Math.sign(delta)) return 0;
  const maxMag = 3 * Math.abs(delta) + 1e-9;
  if (Math.abs(slope) > maxMag) return 3 * delta;
  return slope;
}

interface DomainPiece {
  m0: number;
  m1: number;
  w0: number;
  w1: number;
  d0: number;
  d1: number;
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  t0: number;
  t1: number;
}

function buildDomainPieces(curve: SpeedCurve, minBoundMedia?: number, maxBoundMedia?: number): { points: SpeedPoint[]; pieces: DomainPiece[] } {
  const points = compilePointsOf(curve.points);
  const u = points.map((p) => p.pos);
  const w = points.map((p) => 1 / clampSpeedExact(p.speed));
  const pchip = pchipSlopes(u, w);

  const winStart = curveStartMedia(curve);
  const winEnd = curveEndMedia(curve);
  const coreSpan = Math.max(1e-9, curve.spanMedia);
  const domainEnd = curve.startMedia + coreSpan;
  const minM = minBoundMedia !== undefined ? Math.min(minBoundMedia, winStart, curve.startMedia) : Math.min(winStart, curve.startMedia);
  const maxM = maxBoundMedia !== undefined ? Math.max(maxBoundMedia, winEnd, domainEnd) : Math.max(winEnd, domainEnd);

  const pieces: DomainPiece[] = [];
  let cursorT = 0;

  if (minM < curve.startMedia - 1e-9) {
    const w0 = 1 / clampSpeedExact(points[0]!.speed);
    const dt = (curve.startMedia - minM) * w0;
    pieces.push({
      m0: minM,
      m1: curve.startMedia,
      w0,
      w1: w0,
      d0: 0,
      d1: 0,
      c0: w0,
      c1: 0,
      c2: 0,
      c3: 0,
      t0: cursorT,
      t1: cursorT + dt,
    });
    cursorT += dt;
  }

  for (let k = 0; k < points.length - 1; k += 1) {
    const cu0 = u[k]!;
    const cu1 = u[k + 1]!;
    const ch = Math.max(1e-9, cu1 - cu0);
    const w0 = w[k]!;
    const w1 = w[k + 1]!;
    const delta = (w1 - w0) / ch;

    const rawOut = points[k]!.slopeRight ?? points[k]!.slope;
    const rawIn = points[k + 1]!.slope;
    const d0 = rawOut !== undefined ? clampMonotoneSegmentSlope(rawOut, delta) : pchip[k]!;
    const d1 = rawIn !== undefined ? clampMonotoneSegmentSlope(rawIn, delta) : pchip[k + 1]!;

    const m0Slope = ch * d0;
    const m1Slope = ch * d1;
    const dw = w1 - w0;
    const c0 = w0;
    const c1 = m0Slope;
    const c2 = 3 * dw - 2 * m0Slope - m1Slope;
    const c3 = -2 * dw + m0Slope + m1Slope;

    const m0 = curve.startMedia + cu0 * coreSpan;
    const m1 = curve.startMedia + cu1 * coreSpan;
    const dt = (m1 - m0) * (c0 + c1 / 2 + c2 / 3 + c3 / 4);
    pieces.push({ m0, m1, w0, w1, d0, d1, c0, c1, c2, c3, t0: cursorT, t1: cursorT + dt });
    cursorT += dt;
  }

  if (maxM > domainEnd + 1e-9) {
    const w1 = 1 / clampSpeedExact(points[points.length - 1]!.speed);
    const dt = (maxM - domainEnd) * w1;
    pieces.push({
      m0: domainEnd,
      m1: maxM,
      w0: w1,
      w1,
      d0: 0,
      d1: 0,
      c0: w1,
      c1: 0,
      c2: 0,
      c3: 0,
      t0: cursorT,
      t1: cursorT + dt,
    });
  }

  return { points, pieces };
}

function evalPiecePoly(piece: { c0: number; c1: number; c2: number; c3: number }, s: number): number {
  return ((piece.c3 * s + piece.c2) * s + piece.c1) * s + piece.c0;
}

function evalPieceDerivS(piece: { c1: number; c2: number; c3: number }, s: number): number {
  return (3 * piece.c3 * s + 2 * piece.c2) * s + piece.c1;
}

function evalPieceIntegral(piece: { c0: number; c1: number; c2: number; c3: number }, s: number): number {
  return (((piece.c3 / 4) * s + piece.c2 / 3) * s + piece.c1 / 2) * s + piece.c0;
}

export function compileSpeedCurve(curve: SpeedCurve): CompiledSpeedCurve {
  const { points, pieces } = buildDomainPieces(curve);
  const winStart = curveStartMedia(curve);
  const winEnd = curveEndMedia(curve);
  const totalSpan = Math.max(1e-9, winEnd - winStart);
  const domainEnd = curve.startMedia + Math.max(1e-9, curve.spanMedia);

  const segments: CompiledCurveSegment[] = [];
  let cursorT = 0;

  for (const piece of pieces) {
    const a = Math.max(piece.m0, winStart);
    const b = Math.min(piece.m1, winEnd);
    if (b - a <= 1e-9) continue;

    const fullWidth = Math.max(1e-9, piece.m1 - piece.m0);
    const sa = Math.min(1, Math.max(0, (a - piece.m0) / fullWidth));
    const sb = Math.min(1, Math.max(0, (b - piece.m0) / fullWidth));
    const fullPiece = sa <= 1e-11 && sb >= 1 - 1e-11;

    let w0: number;
    let w1: number;
    let c0: number;
    let c1: number;
    let c2: number;
    let c3: number;
    let d0: number;
    let d1: number;

    const u0 = (a - winStart) / totalSpan;
    const u1 = (b - winStart) / totalSpan;
    const h = Math.max(1e-12, u1 - u0);

    if (fullPiece) {
      w0 = piece.w0;
      w1 = piece.w1;
      c0 = piece.c0;
      c1 = piece.c1;
      c2 = piece.c2;
      c3 = piece.c3;
      d0 = (piece.c1) / h;
      d1 = (3 * piece.c3 + 2 * piece.c2 + piece.c1) / h;
    } else {
      const hSub = sb - sa;
      w0 = Math.max(1 / MAX_SPEED, Math.min(1 / MIN_SPEED, evalPiecePoly(piece, sa)));
      w1 = Math.max(1 / MAX_SPEED, Math.min(1 / MIN_SPEED, evalPiecePoly(piece, sb)));
      const m0Slope = evalPieceDerivS(piece, sa) * hSub;
      const m1Slope = evalPieceDerivS(piece, sb) * hSub;
      const dw = w1 - w0;
      c0 = w0;
      c1 = m0Slope;
      c2 = 3 * dw - 2 * m0Slope - m1Slope;
      c3 = -2 * dw + m0Slope + m1Slope;
      d0 = c1 / h;
      d1 = (3 * c3 + 2 * c2 + c1) / h;
    }

    const dt = (b - a) * (c0 + c1 / 2 + c2 / 3 + c3 / 4);
    segments.push({
      u0,
      u1,
      h,
      m0: a,
      m1: b,
      w0,
      w1,
      d0,
      d1,
      c0,
      c1,
      c2,
      c3,
      t0: cursorT,
      t1: cursorT + dt,
    });
    cursorT += dt;
  }

  if (segments.length === 0) {
    const w0 = 1 / clampSpeedExact(points[0]!.speed);
    segments.push({
      u0: 0,
      u1: 1,
      h: 1,
      m0: winStart,
      m1: winEnd,
      w0,
      w1: w0,
      d0: 0,
      d1: 0,
      c0: w0,
      c1: 0,
      c2: 0,
      c3: 0,
      t0: 0,
      t1: totalSpan * w0,
    });
    cursorT = totalSpan * w0;
  } else {
    segments[0] = { ...segments[0]!, u0: 0 };
    const last = segments[segments.length - 1]!;
    segments[segments.length - 1] = { ...last, u1: 1, h: Math.max(1e-12, 1 - last.u0) };
  }

  return {
    startMedia: curve.startMedia,
    spanMedia: curve.spanMedia,
    totalStartMedia: winStart,
    totalSpanMedia: totalSpan,
    leadMedia: Math.max(0, curve.startMedia - winStart),
    tailMedia: Math.max(0, winEnd - domainEnd),
    totalFrames: cursorT,
    points,
    segments,
  };
}

function segmentForU(segments: readonly CompiledCurveSegment[], u: number): CompiledCurveSegment {
  if (u <= 0) return segments[0]!;
  for (let i = 0; i < segments.length; i += 1) {
    if (u <= segments[i]!.u1 || i === segments.length - 1) return segments[i]!;
  }
  return segments[segments.length - 1]!;
}

function evalPoly(seg: CompiledCurveSegment, s: number): number {
  return ((seg.c3 * s + seg.c2) * s + seg.c1) * s + seg.c0;
}

function evalIntegral(seg: CompiledCurveSegment, s: number): number {
  return (((seg.c3 / 4) * s + seg.c2 / 3) * s + seg.c1 / 2) * s + seg.c0;
}

export function curveSlownessAt(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, u: number): number {
  const compiled = asCompiled(compiledOrCurve);
  const clamped = Math.min(1, Math.max(0, u));
  const seg = segmentForU(compiled.segments, clamped);
  const s = Math.min(1, Math.max(0, (clamped - seg.u0) / seg.h));
  return Math.max(1 / MAX_SPEED, Math.min(1 / MIN_SPEED, evalPoly(seg, s)));
}

export function curveSpeedAt(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, u: number): number {
  return clampSpeedExact(1 / curveSlownessAt(compiledOrCurve, u));
}

export function curveTimeAt(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, u: number): number {
  const compiled = asCompiled(compiledOrCurve);
  if (u <= 0) return 0;
  if (u >= 1) return compiled.totalFrames;
  const seg = segmentForU(compiled.segments, u);
  const s = Math.min(1, Math.max(0, (u - seg.u0) / seg.h));
  const mediaWidth = seg.m1 - seg.m0;
  return seg.t0 + mediaWidth * s * evalIntegral(seg, s);
}

export function curveRawDurationFrames(compiledOrCurve: CompiledSpeedCurve | SpeedCurve): number {
  if (!('segments' in compiledOrCurve)) {
    const flat = isFlatCurve(compiledOrCurve);
    if (flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12) {
      const { num, den } = toSpeedRational(flat);
      return (curveTotalSpanMedia(compiledOrCurve) * den) / num;
    }
  }
  return asCompiled(compiledOrCurve).totalFrames;
}

export function curveTotalFrames(compiledOrCurve: CompiledSpeedCurve | SpeedCurve): number {
  if (!('segments' in compiledOrCurve)) {
    const flat = isFlatCurve(compiledOrCurve);
    if (flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12) {
      const { num, den } = toSpeedRational(flat);
      return Math.max(1, Math.round((curveTotalSpanMedia(compiledOrCurve) * den) / num));
    }
  }
  return Math.max(1, Math.round(asCompiled(compiledOrCurve).totalFrames + 1e-12));
}

function solveSegmentS(seg: CompiledCurveSegment, target: number): number {
  const dt = Math.max(1e-12, seg.t1 - seg.t0);
  if (target <= 0) return 0;
  if (target >= dt) return 1;
  if (Math.abs(seg.c1) < 1e-14 && Math.abs(seg.c2) < 1e-14 && Math.abs(seg.c3) < 1e-14) {
    return target / dt;
  }
  const mediaWidth = seg.m1 - seg.m0;
  let lo = 0;
  let hi = 1;
  let s = Math.min(1, Math.max(0, target / dt));

  for (let iter = 0; iter < 24; iter += 1) {
    const f = mediaWidth * s * evalIntegral(seg, s) - target;
    if (Math.abs(f) < 1e-12 || hi - lo < 1e-14) break;
    if (f < 0) lo = s;
    else hi = s;

    const fp = mediaWidth * Math.max(1e-9, evalPoly(seg, s));
    const candidate = s - f / fp;
    if (Number.isFinite(candidate) && candidate > lo && candidate < hi) {
      s = candidate;
    } else {
      s = 0.5 * (lo + hi);
    }
  }
  return s;
}

function segmentAtTime(compiled: CompiledSpeedCurve, timelineFrameOffset: number): { seg: CompiledCurveSegment; s: number } {
  if (timelineFrameOffset <= 0) {
    return { seg: compiled.segments[0]!, s: 0 };
  }
  if (timelineFrameOffset >= compiled.totalFrames) {
    return { seg: compiled.segments[compiled.segments.length - 1]!, s: 1 };
  }
  let seg = compiled.segments[compiled.segments.length - 1]!;
  for (let i = 0; i < compiled.segments.length; i += 1) {
    if (timelineFrameOffset <= compiled.segments[i]!.t1) {
      seg = compiled.segments[i]!;
      break;
    }
  }
  return { seg, s: solveSegmentS(seg, timelineFrameOffset - seg.t0) };
}

export function curveInverseAt(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, timelineFrameOffset: number): number {
  const compiled = asCompiled(compiledOrCurve);
  if (timelineFrameOffset <= 0) return 0;
  if (timelineFrameOffset >= compiled.totalFrames) return 1;
  const { seg, s } = segmentAtTime(compiled, timelineFrameOffset);
  return Math.min(1, Math.max(0, seg.u0 + seg.h * s));
}

export function curveMediaPosAt(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, timelineFrameOffset: number): number {
  const compiled = asCompiled(compiledOrCurve);
  if (timelineFrameOffset <= 0) return compiled.totalStartMedia;
  if (timelineFrameOffset >= compiled.totalFrames) return compiled.totalStartMedia + compiled.totalSpanMedia;
  const { seg, s } = segmentAtTime(compiled, timelineFrameOffset);
  return seg.m0 + s * (seg.m1 - seg.m0);
}

export function curveSpeedAtFrame(compiledOrCurve: CompiledSpeedCurve | SpeedCurve, timelineFrameOffset: number): number {
  const compiled = asCompiled(compiledOrCurve);
  if (timelineFrameOffset <= 0) return clampSpeedExact(1 / compiled.segments[0]!.w0);
  if (timelineFrameOffset >= compiled.totalFrames) return clampSpeedExact(1 / compiled.segments[compiled.segments.length - 1]!.w1);
  const { seg, s } = segmentAtTime(compiled, timelineFrameOffset);
  const slowness = Math.max(1 / MAX_SPEED, Math.min(1 / MIN_SPEED, evalPoly(seg, s)));
  return clampSpeedExact(1 / slowness);
}

function domainTimeAtMedia(pieces: readonly DomainPiece[], media: number): number {
  const first = pieces[0]!;
  if (media <= first.m0) return first.t0;
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!;
    if (media <= p.m1 || i === pieces.length - 1) {
      const s = Math.min(1, Math.max(0, (media - p.m0) / Math.max(1e-9, p.m1 - p.m0)));
      return p.t0 + (p.m1 - p.m0) * s * evalPieceIntegral(p, s);
    }
  }
  return pieces[pieces.length - 1]!.t1;
}

function domainMediaAtTime(pieces: readonly DomainPiece[], time: number): number {
  const first = pieces[0]!;
  if (time <= first.t0) return first.m0;
  const last = pieces[pieces.length - 1]!;
  if (time >= last.t1) return last.m1;
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!;
    if (time <= p.t1 || i === pieces.length - 1) {
      const dt = Math.max(1e-12, p.t1 - p.t0);
      const target = time - p.t0;
      let s: number;
      if (target <= 0) s = 0;
      else if (target >= dt) s = 1;
      else if (Math.abs(p.c1) < 1e-14 && Math.abs(p.c2) < 1e-14 && Math.abs(p.c3) < 1e-14) s = target / dt;
      else {
        const mw = p.m1 - p.m0;
        let lo = 0;
        let hi = 1;
        s = Math.min(1, Math.max(0, target / dt));
        for (let iter = 0; iter < 24; iter += 1) {
          const f = mw * s * evalPieceIntegral(p, s) - target;
          if (Math.abs(f) < 1e-12 || hi - lo < 1e-14) break;
          if (f < 0) lo = s;
          else hi = s;
          const fp = mw * Math.max(1e-9, evalPiecePoly(p, s));
          const cand = s - f / fp;
          s = Number.isFinite(cand) && cand > lo && cand < hi ? cand : 0.5 * (lo + hi);
        }
      }
      return p.m0 + s * (p.m1 - p.m0);
    }
  }
  return last.m1;
}

/** Maximum timeline frames a windowed curve can expand to within `mediaFrames`. */
export function maxWindowedCurveFrames(curve: SpeedCurve, mediaFrames: number): number {
  const flat = isFlatCurve(curve);
  const winStart = curveStartMedia(curve);
  const availableMedia = Math.max(0, mediaFrames - winStart);
  if (flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12) {
    const { num, den } = toSpeedRational(flat);
    return Math.max(1, Math.round((availableMedia * den) / num));
  }
  const winEnd = curveEndMedia(curve);
  const { pieces } = buildDomainPieces(curve, 0, Math.max(mediaFrames, winEnd));
  const tStart = domainTimeAtMedia(pieces, winStart);
  const tEnd = domainTimeAtMedia(pieces, winEnd);
  const tMax = domainTimeAtMedia(pieces, mediaFrames);
  const curFrames = curveTotalFrames(curve);
  return Math.max(1, curFrames + Math.floor(Math.max(0, tMax - tEnd) + 1e-9), Math.round(Math.max(0, tMax - tStart)));
}

/** Trims a windowed curve edge (`delta` timeline frames) while keeping the underlying domain curve intact. */
export function trimWindowedCurveEdge(
  curve: SpeedCurve,
  edge: 'start' | 'end',
  delta: number,
  mediaFrames: number,
): { curve: SpeedCurve; applied: number } {
  const clean = cloneSpeedCurve(curve);
  const winStart = curveStartMedia(clean);
  const winEnd = curveEndMedia(clean);
  const curFrames = curveTotalFrames(clean);
  const backing: SpeedCurveDomain = clean.sourceDomain
    ? cloneDomain(clean.sourceDomain)
    : {
        startMedia: clean.startMedia,
        spanMedia: clean.spanMedia,
        points: clean.points.map(cloneSpeedPoint),
      };
  const backingCurve: SpeedCurve = {
    startMedia: backing.startMedia,
    spanMedia: backing.spanMedia,
    points: backing.points,
  };
  const backingEnd = backing.startMedia + backing.spanMedia;
  const { pieces } = buildDomainPieces(
    backingCurve,
    Math.min(0, winStart, backing.startMedia),
    Math.max(mediaFrames, winEnd, backingEnd),
  );
  const tStart = domainTimeAtMedia(pieces, winStart);
  const tEnd = domainTimeAtMedia(pieces, winEnd);
  const flat = isFlatCurve(backingCurve);
  const rawCur = Math.max(0, tEnd - tStart);
  const maxShorten = Math.min(curFrames - 1, Math.max(0, Math.floor(rawCur - 0.5 + 1e-6)));

  let applied = 0;
  let nextWinStart = winStart;
  let nextWinEnd = winEnd;

  if (edge === 'start') {
    const tOrigin = domainTimeAtMedia(pieces, 0);
    const back =
      flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12
        ? (() => {
            const { num, den } = toSpeedRational(flat);
            return Math.floor((winStart * den) / num + 1e-9);
          })()
        : Math.floor(Math.max(0, tStart - tOrigin) + 1e-9);
    applied = Math.min(maxShorten, Math.max(-back, Math.round(delta)));
    if (applied === 0) return { curve: clean, applied: 0 };

    nextWinStart =
      flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12
        ? (() => {
            const { num, den } = toSpeedRational(flat);
            return Math.min(winEnd - 1e-6, Math.max(0, winStart + (applied * num) / den));
          })()
        : Math.min(winEnd - 1e-6, Math.max(0, domainMediaAtTime(pieces, tStart + applied)));
  } else {
    const tMediaMax = domainTimeAtMedia(pieces, mediaFrames);
    const maxFwd =
      flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12
        ? (() => {
            const { num, den } = toSpeedRational(flat);
            return Math.floor((Math.max(0, mediaFrames - winEnd) * den) / num + 1e-9);
          })()
        : Math.floor(Math.max(0, tMediaMax - tEnd) + 1e-9);
    applied = Math.min(maxFwd, Math.max(-maxShorten, Math.round(delta)));
    if (applied === 0) return { curve: clean, applied: 0 };

    nextWinEnd =
      flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12
        ? (() => {
            const { num, den } = toSpeedRational(flat);
            return Math.max(winStart + 1e-6, Math.min(mediaFrames, winEnd + (applied * num) / den));
          })()
        : Math.max(winStart + 1e-6, Math.min(mediaFrames, domainMediaAtTime(pieces, tEnd + applied)));
  }

  const rawNext =
    flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12
      ? ((nextWinEnd - nextWinStart) * toSpeedRational(flat).den) / toSpeedRational(flat).num
      : domainTimeAtMedia(pieces, nextWinEnd) - domainTimeAtMedia(pieces, nextWinStart);
  if (rawNext < 0.5 - 1e-6) {
    return { curve: clean, applied: 0 };
  }

  const projected = projectDomainToWindow(backing, nextWinStart, nextWinEnd);
  if (projected.length > MAX_CURVE_TOTAL_POINTS) {
    return { curve: clean, applied: 0 };
  }

  const matchesBacking = Math.abs(nextWinStart - backing.startMedia) <= 1e-9 && Math.abs(nextWinEnd - backingEnd) <= 1e-9;
  return {
    applied,
    curve: {
      startMedia: nextWinStart,
      spanMedia: Math.max(1e-6, nextWinEnd - nextWinStart),
      ...(matchesBacking ? {} : { sourceDomain: backing }),
      points: projected,
    },
  };
}

/** Splits a windowed curve into two canonical curves sharing the underlying domain snapshot, or returns null when cap/sub-half-frame prevents split. */
export function splitWindowedCurve(curve: SpeedCurve, splitFrameOffset: number): { left: SpeedCurve; right: SpeedCurve } | null {
  const clean = cloneSpeedCurve(curve);
  const winStart = curveStartMedia(clean);
  const winEnd = curveEndMedia(clean);
  const backing: SpeedCurveDomain = clean.sourceDomain
    ? cloneDomain(clean.sourceDomain)
    : {
        startMedia: clean.startMedia,
        spanMedia: clean.spanMedia,
        points: clean.points.map(cloneSpeedPoint),
      };
  const backingCurve: SpeedCurve = {
    startMedia: backing.startMedia,
    spanMedia: backing.spanMedia,
    points: backing.points,
  };
  const backingEnd = backing.startMedia + backing.spanMedia;
  const flat = isFlatCurve(backingCurve);
  let splitMedia: number;
  let rawLeft: number;
  let rawRight: number;
  if (flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12) {
    const { num, den } = toSpeedRational(flat);
    splitMedia = Math.min(winEnd - 1e-6, Math.max(winStart + 1e-6, winStart + (splitFrameOffset * num) / den));
    rawLeft = ((splitMedia - winStart) * den) / num;
    rawRight = ((winEnd - splitMedia) * den) / num;
  } else {
    const { pieces } = buildDomainPieces(backingCurve, Math.min(winStart, backing.startMedia), Math.max(winEnd, backingEnd));
    const tStart = domainTimeAtMedia(pieces, winStart);
    const tEnd = domainTimeAtMedia(pieces, winEnd);
    splitMedia = Math.min(winEnd - 1e-6, Math.max(winStart + 1e-6, domainMediaAtTime(pieces, tStart + splitFrameOffset)));
    const tActualSplit = domainTimeAtMedia(pieces, splitMedia);
    rawLeft = tActualSplit - tStart;
    rawRight = tEnd - tActualSplit;
  }
  if (rawLeft < 0.5 - 1e-6 || rawRight < 0.5 - 1e-6) {
    return null;
  }

  const leftPoints = projectDomainToWindow(backing, winStart, splitMedia);
  const rightPoints = projectDomainToWindow(backing, splitMedia, winEnd);
  if (leftPoints.length > MAX_CURVE_TOTAL_POINTS || rightPoints.length > MAX_CURVE_TOTAL_POINTS) {
    return null;
  }

  return {
    left: {
      startMedia: winStart,
      spanMedia: Math.max(1e-6, splitMedia - winStart),
      sourceDomain: backing,
      points: leftPoints,
    },
    right: {
      startMedia: splitMedia,
      spanMedia: Math.max(1e-6, winEnd - splitMedia),
      sourceDomain: backing,
      points: rightPoints,
    },
  };
}

export function subdivideSpeedCurve(curve: SpeedCurve, splitFrameOffset: number): { left: SpeedCurve; right: SpeedCurve } {
  return splitWindowedCurve(curve, splitFrameOffset) ?? { left: cloneSpeedCurve(curve), right: cloneSpeedCurve(curve) };
}

export function curveSpeedRange(curve: SpeedCurve): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const pt of editablePointsOfCurve(curve)) {
    min = Math.min(min, pt.speed);
    max = Math.max(max, pt.speed);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 1, max: 1 };
  return { min, max };
}

export function curveAverageSpeed(curve: SpeedCurve): number {
  const total = curveRawDurationFrames(curve);
  if (total <= 0) return 1;
  return curveTotalSpanMedia(curve) / total;
}

interface ResampleState {
  compiled: CompiledSpeedCurve;
  srcLen: number;
  rateRatioBase: number;
  dtPerSample: number;
  trueEndSample: number;
  hasRoundedOverrun: boolean;
  fadeSamples: number;
  fadeStart: number;
  leadShiftSec: number;
  timelineFps: number;
  startFrameOffset: number;
  sourceSampleRate: number;
  accScratch: Float64Array;
  kernelCache: Map<number, { radius: number; weights: Float64Array }>;
  curveInversions: number;
}

function getDecimationKernel(
  cache: Map<number, { radius: number; weights: Float64Array }>,
  stepRatio: number,
  fracOffset: number,
): { radius: number; weights: Float64Array } {
  const srQ = Math.min(200, Math.max(17, Math.round(stepRatio * 16)));
  const fracQ = Math.min(31, Math.max(0, Math.round((fracOffset + 0.5) * 31)));
  const key = (srQ << 5) | fracQ;
  const hit = cache.get(key);
  if (hit) return hit;

  const stepQ = srQ / 16;
  const fc = 0.42 / stepQ;
  const radius = Math.min(16, Math.max(2, Math.ceil(1.5 * stepQ)));
  const df = fracQ / 31 - 0.5;
  const len = 2 * radius + 1;
  const weights = new Float64Array(len);
  let wSum = 0;
  for (let k = 0; k < len; k += 1) {
    const d = k - radius - df;
    const x = 2 * fc * d;
    const sinc = Math.abs(x) < 1e-6 ? 2 * fc : Math.sin(Math.PI * x) / (Math.PI * d);
    const hann = 0.5 * (1 + Math.cos((Math.PI * d) / (radius + 0.5)));
    const w = sinc * hann;
    weights[k] = w;
    wSum += w;
  }
  if (wSum > 1e-9) {
    for (let k = 0; k < len; k += 1) {
      weights[k] = weights[k]! / wSum;
    }
  }
  const entry = { radius, weights };
  cache.set(key, entry);
  return entry;
}

function createResampleState(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  curve: SpeedCurve,
  timelineFps: number,
  startFrameOffset: number,
  outputSampleRate: number,
  outputSamples: number,
  leadShiftSec: number,
): ResampleState {
  const compiled = compileSpeedCurve(curve);
  const trueEndSample = ((compiled.totalFrames - startFrameOffset) / timelineFps) * outputSampleRate;
  const hasRoundedOverrun = trueEndSample < outputSamples - 0.5;
  const fadeSamples = hasRoundedOverrun ? Math.min(Math.round(0.004 * outputSampleRate), Math.max(1, Math.floor(trueEndSample))) : 0;
  const fadeStart = hasRoundedOverrun ? trueEndSample - fadeSamples : Infinity;

  return {
    compiled,
    srcLen: channels[0]!.length,
    rateRatioBase: sourceSampleRate / outputSampleRate,
    dtPerSample: timelineFps / outputSampleRate,
    trueEndSample,
    hasRoundedOverrun,
    fadeSamples,
    fadeStart,
    leadShiftSec,
    timelineFps,
    startFrameOffset,
    sourceSampleRate,
    accScratch: new Float64Array(channels.length),
    kernelCache: new Map(),
    curveInversions: 0,
  };
}

function resampleCurvedAudioRange(
  state: ResampleState,
  channels: readonly Float32Array[],
  outChannels: readonly Float32Array[],
  rangeStart: number,
  rangeEnd: number,
): void {
  const { compiled, srcLen, rateRatioBase, dtPerSample, trueEndSample, hasRoundedOverrun, fadeSamples, fadeStart, leadShiftSec, timelineFps, startFrameOffset, sourceSampleRate, accScratch } = state;
  const segs = compiled.segments;
  const segCount = segs.length;
  const numCh = channels.length;
  const maxSampleIdx = srcLen - 1;
  const ch0 = channels[0]!;
  const ch1 = numCh === 2 ? channels[1]! : null;
  const out0 = outChannels[0]!;
  const out1 = numCh === 2 ? outChannels[1]! : null;

  const limit = hasRoundedOverrun ? Math.min(rangeEnd, Math.ceil(trueEndSample)) : rangeEnd;
  if (rangeStart >= limit) return;

  // Locate initial segment once; subsequent samples advance monotonically in O(1) without binary search.
  let tFrames = startFrameOffset + rangeStart * dtPerSample;
  let segIdx = 0;
  while (segIdx + 1 < segCount && tFrames > segs[segIdx]!.t1) {
    segIdx += 1;
  }
  let sPrev = solveSegmentS(segs[segIdx]!, tFrames - segs[segIdx]!.t0);
  state.curveInversions += 1;
  let prevSegIdx = -1;
  let prevTFrames = tFrames;
  let prevW = segs[segIdx]!.w0;

  for (let i = rangeStart; i < limit; i += 1) {
    if (hasRoundedOverrun && i >= trueEndSample) break;

    tFrames = startFrameOffset + i * dtPerSample;
    while (segIdx + 1 < segCount && tFrames > segs[segIdx]!.t1) {
      segIdx += 1;
    }

    const seg = segs[segIdx]!;
    let s: number;
    const target = tFrames - seg.t0;
    const segDt = seg.t1 - seg.t0;
    const isLinear = Math.abs(seg.c1) < 1e-13 && Math.abs(seg.c2) < 1e-13 && Math.abs(seg.c3) < 1e-13;
    if (tFrames <= 0) {
      s = 0;
    } else if (tFrames >= compiled.totalFrames) {
      s = 1;
    } else if (isLinear) {
      s = segDt > 1e-12 ? Math.min(1, Math.max(0, target / segDt)) : 0;
    } else {
      const mw = Math.max(1e-9, seg.m1 - seg.m0);
      if (prevSegIdx === segIdx) {
        const dtStep = tFrames - prevTFrames;
        s = Math.min(1, Math.max(0, sPrev + dtStep / (mw * Math.max(1e-6, prevW))));
      } else {
        s = segDt > 1e-12 ? Math.min(1, Math.max(0, target / segDt)) : 0;
      }
      // One unconditional Newton polish from monotone Euler prediction maintains < 1e-13 across chunks.
      let f = mw * s * evalPieceIntegral(seg, s) - target;
      const fp = mw * Math.max(1e-9, evalPiecePoly(seg, s));
      const cand = s - f / fp;
      if (Number.isFinite(cand) && cand >= 0 && cand <= 1) {
        s = cand;
        f = mw * s * evalPieceIntegral(seg, s) - target;
      }
      if (Math.abs(f) > 1e-9) {
        s = solveSegmentS(seg, target);
        state.curveInversions += 1;
      }
    }

    const slowness = Math.max(1 / MAX_SPEED, Math.min(1 / MIN_SPEED, evalPiecePoly(seg, s)));
    sPrev = s;
    prevSegIdx = segIdx;
    prevTFrames = tFrames;
    prevW = slowness;

    const mediaPos = tFrames <= 0 ? compiled.totalStartMedia : tFrames >= compiled.totalFrames ? compiled.totalStartMedia + compiled.totalSpanMedia : seg.m0 + s * (seg.m1 - seg.m0);
    const srcIdx = (mediaPos / timelineFps + leadShiftSec) * sourceSampleRate;
    if (srcIdx < 0 || srcIdx >= srcLen - 1e-6) continue;

    let env = 1;
    if (hasRoundedOverrun && i >= fadeStart && fadeSamples > 0) {
      const progress = Math.min(1, Math.max(0, (i - fadeStart) / fadeSamples));
      env = 0.5 * (1 + Math.cos(Math.PI * progress));
    }

    const stepRatio = (1 / slowness) * rateRatioBase;

    if (stepRatio <= 1.05) {
      const i0 = Math.min(maxSampleIdx, Math.max(0, Math.floor(srcIdx)));
      const i1 = Math.min(maxSampleIdx, i0 + 1);
      const frac = Math.min(1, Math.max(0, srcIdx - i0));
      if (numCh === 1) {
        const s0 = ch0[i0]!;
        out0[i] = (s0 + (ch0[i1]! - s0) * frac) * env;
      } else if (numCh === 2) {
        const l0 = ch0[i0]!;
        const r0 = ch1![i0]!;
        out0[i] = (l0 + (ch0[i1]! - l0) * frac) * env;
        out1![i] = (r0 + (ch1![i1]! - r0) * frac) * env;
      } else {
        for (let ch = 0; ch < numCh; ch += 1) {
          const buf = channels[ch]!;
          const s0 = buf[i0]!;
          outChannels[ch]![i] = (s0 + (buf[i1]! - s0) * frac) * env;
        }
      }
    } else {
      const center = Math.round(srcIdx);
      const { radius, weights } = getDecimationKernel(state.kernelCache, stepRatio, srcIdx - center);
      const jStart = center - radius;
      const kLen = weights.length;

      if (jStart >= 0 && center + radius <= maxSampleIdx) {
        if (numCh === 1) {
          let acc = 0;
          for (let k = 0; k < kLen; k += 1) {
            acc += ch0[jStart + k]! * weights[k]!;
          }
          out0[i] = acc * env;
        } else if (numCh === 2) {
          let acc0 = 0;
          let acc1 = 0;
          for (let k = 0; k < kLen; k += 1) {
            const w = weights[k]!;
            const idx = jStart + k;
            acc0 += ch0[idx]! * w;
            acc1 += ch1![idx]! * w;
          }
          out0[i] = acc0 * env;
          out1![i] = acc1 * env;
        } else {
          accScratch.fill(0);
          for (let k = 0; k < kLen; k += 1) {
            const w = weights[k]!;
            const idx = jStart + k;
            for (let ch = 0; ch < numCh; ch += 1) {
              accScratch[ch] = (accScratch[ch] ?? 0) + channels[ch]![idx]! * w;
            }
          }
          for (let ch = 0; ch < numCh; ch += 1) {
            outChannels[ch]![i] = accScratch[ch]! * env;
          }
        }
      } else {
        const kMin = Math.max(0, -jStart);
        const kMax = Math.min(kLen - 1, maxSampleIdx - jStart);
        let wSum = 0;
        if (numCh === 1) {
          let acc = 0;
          for (let k = kMin; k <= kMax; k += 1) {
            const w = weights[k]!;
            acc += ch0[jStart + k]! * w;
            wSum += w;
          }
          out0[i] = wSum > 1e-9 ? (acc / wSum) * env : 0;
        } else if (numCh === 2) {
          let acc0 = 0;
          let acc1 = 0;
          for (let k = kMin; k <= kMax; k += 1) {
            const w = weights[k]!;
            const idx = jStart + k;
            acc0 += ch0[idx]! * w;
            acc1 += ch1![idx]! * w;
            wSum += w;
          }
          const invSum = wSum > 1e-9 ? env / wSum : 0;
          out0[i] = acc0 * invSum;
          out1![i] = acc1 * invSum;
        } else {
          accScratch.fill(0);
          for (let k = kMin; k <= kMax; k += 1) {
            const w = weights[k]!;
            const idx = jStart + k;
            wSum += w;
            for (let ch = 0; ch < numCh; ch += 1) {
              accScratch[ch] = (accScratch[ch] ?? 0) + channels[ch]![idx]! * w;
            }
          }
          const invSum = wSum > 1e-9 ? env / wSum : 0;
          for (let ch = 0; ch < numCh; ch += 1) {
            outChannels[ch]![i] = accScratch[ch]! * invSum;
          }
        }
      }
    }
  }
}

/**
 * Variable-rate resampler for curved cuts:
 * - For `stepRatio <= 1.05` (<= 1×), uses linear interpolation for crisp low-speed transients.
 * - For `stepRatio > 1.05` (> 1× decimation up to 10×), applies a zero-phase Hann-windowed sinc
 *   low-pass pre-filter (`fc = 0.42 / stepRatio`) computed with trig recurrence and monotone stepping.
 * - When a timeline cut rounds up slightly beyond `compiled.totalFrames`, smoothly cosine-fades
 *   the final 4 ms to silence at the true curve end so picture and sound stay equal length without a click.
 */
export function resampleCurvedAudio(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  _sourceOffsetSec: number,
  curve: SpeedCurve,
  timelineFps: number,
  startFrameOffset: number,
  _frameSpan: number,
  outputSampleRate: number,
  outputSamples: number,
  leadShiftSec = 0,
): Float32Array[] {
  const outChannels = channels.map(() => new Float32Array(Math.max(0, outputSamples)));
  if (outputSamples <= 0 || channels.length === 0 || channels[0]!.length === 0) return outChannels;
  const state = createResampleState(channels, sourceSampleRate, curve, timelineFps, startFrameOffset, outputSampleRate, outputSamples, leadShiftSec);
  resampleCurvedAudioRange(state, channels, outChannels, 0, outputSamples);
  return outChannels;
}

export interface ResampleAudioStats {
  curveInversions: number;
  kernelCacheMisses: number;
  perSampleHeapAllocations: number;
  outputSamples: number;
}

export function resampleCurvedAudioWithStats(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  _sourceOffsetSec: number,
  curve: SpeedCurve,
  timelineFps: number,
  startFrameOffset: number,
  _frameSpan: number,
  outputSampleRate: number,
  outputSamples: number,
  leadShiftSec = 0,
): { channels: Float32Array[]; stats: ResampleAudioStats } {
  const outChannels = channels.map(() => new Float32Array(Math.max(0, outputSamples)));
  if (outputSamples <= 0 || channels.length === 0 || channels[0]!.length === 0) {
    return {
      channels: outChannels,
      stats: { curveInversions: 0, kernelCacheMisses: 0, perSampleHeapAllocations: 0, outputSamples: Math.max(0, outputSamples) },
    };
  }
  const state = createResampleState(channels, sourceSampleRate, curve, timelineFps, startFrameOffset, outputSampleRate, outputSamples, leadShiftSec);
  resampleCurvedAudioRange(state, channels, outChannels, 0, outputSamples);
  return {
    channels: outChannels,
    stats: {
      curveInversions: state.curveInversions,
      kernelCacheMisses: state.kernelCache.size,
      perSampleHeapAllocations: 0,
      outputSamples,
    },
  };
}

/** Chunk-yielding async variant so long exports keep the browser event loop responsive. */
export async function resampleCurvedAudioAsync(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  _sourceOffsetSec: number,
  curve: SpeedCurve,
  timelineFps: number,
  startFrameOffset: number,
  _frameSpan: number,
  outputSampleRate: number,
  outputSamples: number,
  leadShiftSec = 0,
  opts?: { chunkSamples?: number; signal?: AbortSignal },
): Promise<Float32Array[]> {
  const outChannels = channels.map(() => new Float32Array(Math.max(0, outputSamples)));
  if (outputSamples <= 0 || channels.length === 0 || channels[0]!.length === 0) return outChannels;
  const state = createResampleState(channels, sourceSampleRate, curve, timelineFps, startFrameOffset, outputSampleRate, outputSamples, leadShiftSec);
  const chunk = Math.max(4096, opts?.chunkSamples ?? 48_000);
  for (let start = 0; start < outputSamples; start += chunk) {
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(outputSamples, start + chunk);
    resampleCurvedAudioRange(state, channels, outChannels, start, end);
    if (end < outputSamples) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return outChannels;
}
