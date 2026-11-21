/**
 * Server-side texts a starter workflow sends in place of what the customer sees (`params.preset` on a job).
 * A preset run's visible `prompt` is a short line; the text the model receives is assembled here when the job
 * is prepared (lib/brand-studio/prepare.ts), never rewritten, never shown, never re-run from the gallery.
 *
 * Server-only leaf modules: no studio runtime imports, and no client code imports this folder.
 */
import { renderVideoCharacterSheetPrompt, VIDEO_CHARACTER_SHEET_PRESET_ID } from './video-character-sheet';

export interface StudioJobPreset {
  id: string;
  vars: Record<string, string>;
}

/** The text a preset sends, or null for an unknown (or absent) preset. */
export function renderPresetPrompt(preset: StudioJobPreset | null | undefined): string | null {
  if (!preset || typeof preset !== 'object' || typeof preset.id !== 'string') return null;
  const vars = preset.vars && typeof preset.vars === 'object' && !Array.isArray(preset.vars) ? preset.vars : {};
  switch (preset.id) {
    case VIDEO_CHARACTER_SHEET_PRESET_ID:
      return renderVideoCharacterSheetPrompt(vars);
    default:
      return null;
  }
}
