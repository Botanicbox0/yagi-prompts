/**
 * Editing studio v2, V1 — what the exported file of a real film carries besides the cuts, read from the
 * stored film (review round 1, item 6). The current editor puts captions, a colour grade, music, sound
 * effects and still images over the picture into the film; v2's export carries them too, so the export
 * sheet and the film panel name them before anyone exports. Counted the way the exporters draw and mix
 * them: only what lands inside the film's length. Pure.
 */
import type { ComposeColorPresetId, ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { activeColorGradeForFrame, normalizeColorGradeState } from '@/lib/brand-studio/compose/timeline';
import { captionsOnFrames, effectStartSec, overlayFrames, type CutAnchor } from './cut-anchor';
import { storedCutFor } from './export-plan';
import { totalFrames, visibleCaptions, type FrameSequence } from './frames';

/**
 * The current editor's names for its colour presets, by the copy key it shows each under
 * (components/brand-studio/compose/video-composer.tsx:827-842, `presetLabel`, private there).
 */
export const GRADE_PRESET_COPY_KEYS = {
  'twings-french-blue': 'frenchBlue',
  'clean-high-key': 'cleanHighKey',
  'editorial-cool-porcelain': 'coolPorcelain',
  'kodak-2383-warm': 'filmWarm',
  'moody-teal-amber': 'tealAmber',
  'pastel-airy-film': 'pastelAiry',
} as const satisfies Record<ComposeColorPresetId, string>;

export type GradeCopyKey = (typeof GRADE_PRESET_COPY_KEYS)[ComposeColorPresetId];

/** The current editor's own words for a colour grade (`studioCompose.colorGrade`), handed to the editor by its page. */
export interface GradeNames {
  presets: Readonly<Record<GradeCopyKey, string>>;
  /** `참조 색감: {name}` */
  reference: string;
}

export type FilmGrade = { kind: 'preset'; key: GradeCopyKey } | { kind: 'reference'; label: string } | { kind: 'custom' };

export interface FilmContents {
  cuts: number;
  /** Captions that show inside the film (one past its end is not in the file). */
  captions: number;
  /** The colour grade, when it applies to at least one cut of the film. */
  grade: FilmGrade | null;
  /** The music's label, when it is mixed in (volume above zero). */
  music: string | null;
  /** Sound effects that start inside the film. */
  effects: number;
  /** Still images over the picture that show on at least one frame. */
  stills: number;
}

/** `anchor`: how the stored film's timed things land on these cuts (lib/brand-studio/editor-v2/cut-anchor.ts). */
export function filmContents(sequence: FrameSequence, film: ComposerProject | null | undefined, anchor: CutAnchor | null | undefined): FilmContents {
  const total = totalFrames(sequence);
  const fps = sequence.fps;
  const seconds = total / fps;
  if (!film || !anchor) return { cuts: sequence.clips.length, captions: 0, grade: null, music: null, effects: 0, stills: 0 };
  const shown = visibleCaptions({ ...sequence, captions: captionsOnFrames(film.captions, anchor) }).filter((caption) => caption.text.trim() !== '');
  const grade = normalizeColorGradeState(film.colorGrade);
  const graded = !!grade && sequence.clips.some((clip, index) => activeColorGradeForFrame(film, storedCutFor(film, clip, index)) !== null);
  return {
    cuts: sequence.clips.length,
    captions: shown.length,
    grade: !graded || !grade
      ? null
      : grade.presetId
        ? { kind: 'preset', key: GRADE_PRESET_COPY_KEYS[grade.presetId] }
        : grade.referenceLabel
          ? { kind: 'reference', label: grade.referenceLabel }
          : { kind: 'custom' },
    music: film.bgm && film.bgm.volume > 0 && film.bgm.srcUrl ? film.bgm.label : null,
    effects: (film.sfxClips ?? []).filter((effect) => effect.volume > 0 && !!effect.srcUrl && effectStartSec(anchor, effect) < seconds).length,
    // Shown on at least one frame (export-plan.ts imageOverlaysAt): its first frame is inside the film.
    stills: (film.overlays ?? []).filter((overlay) => overlay.mediaKind === 'image' && overlayFrames(anchor, overlay).first < total).length,
  };
}

/** The grade's name as the current editor shows it. */
export function gradeName(grade: FilmGrade, names: GradeNames | null | undefined, fallback: string): string {
  if (!names) return fallback;
  if (grade.kind === 'preset') return names.presets[grade.key] ?? fallback;
  if (grade.kind === 'reference') return names.reference.replace('{name}', grade.label);
  return fallback;
}
