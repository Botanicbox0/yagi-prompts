/**
 * The blueprint method (docs/BRAND-STUDIO-V3.md §6): a reference video is read into a shot table and a
 * new take is written from that table alone. The video never reaches the generator, so every move,
 * handover and subject has to be in the words (the seedance-film-director house form):
 *
 *   reference lines for the attached images
 *   Visual style: the world, the light, the colours and where they sit, the texture
 *   On screen: each subject with its count, kept alike in every range
 *   0.0–2.4s: framing. One action. Camera — travel …; pan/tilt …; zoom …. Hard cut.
 *   …                                           (contiguous from 0 to the full length)
 *   Last frame: …
 *   Audio: …
 *
 * `composeBlueprintPrompt` is the deterministic form used when the prompt writer is unavailable or its
 * answer fails `blueprintShape`. It adds nothing the reading or the customer did not give.
 */
import type { FilmSheet, StudioKeepKey } from '@/lib/brand-studio/contracts';
import { audioLine, formatRange, referenceClause, type PlannedShot } from './lines';
import { mapCustomerMentions, type Binding } from './references';
import type { EnhanceInput, EnhanceVideo } from './types';

export interface BlueprintShot extends PlannedShot {
  /** How the range hands over to the next ("hard cut", "dissolve", "continuous, no cut"). */
  transition?: string;
  /** The camera split apart: body travel, pan/tilt/roll, lens zoom. */
  move?: { travel: string; turn: string; zoom: string };
}

export function isBlueprint(input: Pick<EnhanceInput, 'kind' | 'video'>): boolean {
  return input.kind === 'video_remix' && input.video?.method === 'blueprint';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function clean(text: string | undefined | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '');
}

function sentence(text: string): string {
  const t = clean(text);
  if (!t) return '';
  const capital = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?…"”'’]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * The shot table laid on the output length: contiguous from 0 to the end, scaled when the lengths
 * differ, at 0.1 s; each range keeps its handover and its split camera. Empty without a sheet or a length.
 */
export function blueprintShots(seconds: number | null, video: Pick<EnhanceVideo, 'sheet'> | null | undefined): BlueprintShot[] {
  const sheet = video?.sheet;
  if (!sheet || !seconds || seconds <= 0 || sheet.shots.length === 0) return [];
  const source = sheet.seconds > 0 ? sheet.seconds : Math.max(...sheet.shots.map((s) => s.end));
  if (!(source > 0)) return [];
  const factor = seconds / source;
  const shots = [...sheet.shots].sort((a, b) => a.start - b.start);
  const out: BlueprintShot[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i]!;
    const start = out.length ? out[out.length - 1]!.end : 0;
    const end = i === shots.length - 1 ? round1(seconds) : round1(Math.min(seconds, s.end * factor));
    if (end - start < 0.1) continue;
    out.push({
      start,
      end,
      framing: s.framing,
      camera: s.camera,
      action: s.action,
      ...(s.transition ? { transition: s.transition } : {}),
      ...(s.move ? { move: { ...s.move } } : {}),
    });
  }
  if (out.length > 0) out[out.length - 1]!.end = round1(seconds);
  return out;
}

const CONTINUOUS = /\b(?:continuous|no cut|one take|single take|same take|uninterrupted)\b/i;
const NONE = /^(?:none|no|static|locked[- ]?off|n\/a|-)?$/i;

/** The sentence that closes a range: how it hands over to the next. The last range closes without one. */
export function handover(shot: Pick<BlueprintShot, 'transition'>, last: boolean): string {
  if (last) return '';
  const t = clean(shot.transition);
  if (!t || /^end$/i.test(t)) return 'Hard cut.';
  if (CONTINUOUS.test(t)) return 'Continuous into the next range, no cut.';
  return sentence(t);
}

/** The camera with travel, pan/tilt and zoom said apart when the reading split them; else its one sentence. */
export function cameraLine(shot: Pick<BlueprintShot, 'camera' | 'move'>): string {
  const m = shot.move;
  if (m) {
    const travel = clean(m.travel), turn = clean(m.turn), zoom = clean(m.zoom);
    if (NONE.test(travel) && NONE.test(turn) && NONE.test(zoom)) return 'Camera: locked off, no travel, pan, tilt or zoom.';
    const part = (text: string) => (NONE.test(text) ? 'none' : text);
    return `Camera — travel: ${part(travel)}; pan/tilt: ${part(turn)}; zoom: ${part(zoom)}.`;
  }
  const camera = clean(shot.camera);
  return camera ? `Camera: ${sentence(camera)}` : '';
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "On screen: A — one woman in a white shirt; B — two glass bottles. Keep these counts in every range." */
export function subjectsLine(subjects: FilmSheet['subjects']): string {
  const list = (subjects ?? []).filter((s) => clean(s.what));
  if (!list.length) return '';
  const items = list.map((s) => `${clean(s.id) || '?'} — ${COUNT_WORDS[s.count] ?? String(s.count)} ${clean(s.what)}`);
  return `On screen: ${items.join('; ')}. Keep these counts in every range.`;
}

/** "Visual style:" from the reading's setting and look; null when the reading gave none. */
export function styleLine(sheet: Pick<FilmSheet, 'look' | 'setting'> | null | undefined): string | null {
  if (!sheet) return null;
  const parts = [sheet.setting, sheet.look.lighting, sheet.look.palette, sheet.look.texture].map((p) => sentence(p ?? '')).filter(Boolean);
  return parts.length ? `Visual style: ${parts.join(' ')}` : null;
}

function rangeLine(shot: BlueprintShot, last: boolean, keep: ReadonlySet<StudioKeepKey>): string {
  const body = [keep.has('composition') ? sentence(shot.framing) : '', keep.has('motion') ? sentence(shot.action) : '']
    .filter(Boolean)
    .join(' ');
  const parts = [body || 'Continue the scene.', keep.has('camera') ? cameraLine(shot) : '', handover(shot, last)];
  return `${formatRange(shot.start, shot.end)}: ${parts.filter(Boolean).join(' ')}`;
}

/** The deterministic blueprint prompt (the shot table written out as a timeline). */
export function composeBlueprintPrompt(
  input: EnhanceInput,
  binding: Binding,
  request: string,
  seconds: number | null,
  env: Record<string, string | undefined> = process.env,
): string {
  const video = input.video;
  const keep = new Set<StudioKeepKey>(video?.keep ?? []);
  const sheet = video?.sheet ?? null;
  const shots = blueprintShots(seconds, video);
  const change = mapCustomerMentions(video?.change?.trim() ?? '', binding.bound);
  const lines: string[] = [];
  lines.push(...binding.bound.filter((b) => b.token && b.ref.kind !== 'video').map((b) => referenceClause(input.profile, b, env)));
  if (binding.seedanceMode === 'frames') {
    lines.push('Start from the opening frame and move on from it.');
    if (binding.bound.some((b) => b.ref.frame === 'end')) lines.push('End on the closing frame.');
  }
  if (keep.has('look')) {
    const style = styleLine(sheet);
    if (style) lines.push(style);
  }
  const cast = subjectsLine(sheet?.subjects);
  if (cast) lines.push(cast);
  // The panel sends one line per thing that changes (product, person, place); they read as one sentence here.
  const changes = change.split(/\n+/).map(clean).filter(Boolean);
  if (changes.length) lines.push(`Change: ${sentence(changes.join('; '))} Apply it wherever it appears below; everything else follows the timeline.`);
  if (request) lines.push(sentence(request));
  shots.forEach((shot, i) => lines.push(rangeLine(shot, i === shots.length - 1, keep)));
  const last = shots[shots.length - 1];
  if (last && (keep.has('composition') || keep.has('motion'))) {
    const end = [keep.has('composition') ? clean(last.framing) : '', keep.has('motion') ? clean(last.action) : ''].filter(Boolean).join(', ');
    if (end) lines.push(`Last frame: ${sentence(end)}`);
  }
  const audio = audioLine(video?.audio ?? 'native');
  if (audio) lines.push(audio);
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

const RANGE_LINE = /^[ \t>*_-]*(\d{1,3}(?:\.\d+)?)\s*s?\s*[–—-]\s*(\d{1,3}(?:\.\d+)?)\s*s\b(.*)$/gim;
const HANDOVER = /\b(?:cut|dissolve|continuous|transition|wipe|whip|match|fade|smash|cross|no cut|carries|flows)\b/i;

/**
 * Whether a written blueprint has the house shape: ranges contiguous from 0 to the full length, a
 * handover at every boundary, and a "Visual style:" block when the look is kept. A model answer that
 * fails this is replaced by `composeBlueprintPrompt`, which passes by construction.
 */
export function blueprintShape(prompt: string, seconds: number | null, keep?: readonly StudioKeepKey[]): boolean {
  if (keep?.includes('look') && !/^[ \t*_]*visual style\b/im.test(prompt)) return false;
  if (!seconds) return true;
  const ranges = [...prompt.matchAll(RANGE_LINE)].map((m) => ({ start: Number(m[1]), end: Number(m[2]), rest: m[3] ?? '' }));
  if (ranges.length === 0) return false;
  if (Math.abs(ranges[0]!.start) > 0.05) return false;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i]!;
    if (!(r.end > r.start)) return false;
    if (i > 0 && Math.abs(r.start - ranges[i - 1]!.end) > 0.15) return false;
    if (i < ranges.length - 1 && !HANDOVER.test(r.rest)) return false;
  }
  return Math.abs(ranges[ranges.length - 1]!.end - seconds) <= 0.15;
}
