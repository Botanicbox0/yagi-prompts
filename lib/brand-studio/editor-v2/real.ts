/**
 * Editing studio v2, V1 — what the editor is when it opens the organization's real film
 * (docs/BRAND-EDITING-STUDIO-V2.md §3-5, §11 V1).
 *
 * The rule: sample values never look real. While a real film is open only cutting is real and saved.
 * Colour, sound and captions are locked (their tab opens a calm panel that says so and points to the
 * earlier editor, and to the sample film only while `BRAND_WORKSPACE_PROTOTYPE_LAYER=on`),
 * titles and framing are not offered (nothing stores or exports them yet), and "말로 편집" follows only
 * the cut sentences. Nothing here reads the sample data. Pure.
 */
import type { ComposeAspect } from '@/lib/brand-studio/compose/timeline';
import { DEFAULT_FILM_FPS } from './fps';
import type { FrameSequence } from './frames';
import type { AssistIntent, EditorDoc, EditorWorkspace } from './model';

/** The workspaces a real film can use in V1. */
export const REAL_OPEN_WORKSPACES: readonly EditorWorkspace[] = ['cut'];

export function workspaceLocked(real: boolean, workspace: EditorWorkspace): boolean {
  return real && !REAL_OPEN_WORKSPACES.includes(workspace);
}

/** The sentences "말로 편집" follows on a real film: the cut ones. */
export const REAL_ASSIST_KINDS: ReadonlyArray<AssistIntent['kind']> = ['aspect', 'trim', 'remove_last'];

export function realAssistAllowed(intent: AssistIntent): boolean {
  return REAL_ASSIST_KINDS.includes(intent.kind);
}

export function emptyFilm(fps: number = DEFAULT_FILM_FPS, aspect: ComposeAspect = '9:16'): FrameSequence {
  return { fps, aspect, clips: [], captions: [] };
}

/** A real film in the editor's document: the cuts and nothing else, every other part neutral. */
export function realDoc(sequence: FrameSequence): EditorDoc {
  return {
    sequence,
    looks: {},
    reframe: {},
    sound: { speechClear: false, duck: null, loudness: false, fades: false, musicVolume: 1 },
    music: null,
    captionSettings: { styleId: 'clean', safeArea: 'none', lift: false, output: 'burn' },
    titles: [],
  };
}

/** The sample film's address for a workspace, from the editor's own `?sample=1` address. */
export function sampleHrefFor(sampleBase: string, workspace: EditorWorkspace): string {
  const [path, query = ''] = sampleBase.split('?');
  const params = new URLSearchParams(query);
  params.set('sample', '1');
  params.set('ws', workspace);
  return `${path}?${params.toString()}`;
}
