/**
 * Every model call in product code (lib/, app/), and where it stands with the prompt guard
 * (docs/PROMPT-GUARD.md "Inventory"). inventory.test.ts finds the calls with CALL_PATTERNS and fails when a
 * file's count of a kind differs from this list: a new model call must be adopted (a row in rows.ts) or
 * listed here as not yet adopted, with the slice that will take it. Audit numbers are AUDIT.md §1.2.
 * Scripts under scripts/ are left out, as in the audit: no customer reaches them.
 */

export type CallKind = 'gemini-json' | 'gemini-structured' | 'gemini-generate' | 'gemini-interactions' | 'openai' | 'ollama' | 'argon';

/** One line of code that calls a model, by kind. Comment lines and the two wrappers' own definitions are skipped. */
export const CALL_PATTERNS: ReadonlyArray<{ kind: CallKind; re: RegExp }> = [
  { kind: 'gemini-json', re: /\bcallGeminiJson\(/ },
  { kind: 'gemini-structured', re: /\bcallGeminiStructuredJson(?:<[^>]*>)?\(/ },
  { kind: 'gemini-generate', re: /:generateContent\b/ },
  { kind: 'gemini-interactions', re: /\/interactions[`'"]/ },
  { kind: 'openai', re: /\/v1\/responses\b|\/images\/(?:generations|edits)\b/ },
  { kind: 'ollama', re: /['"`]\/api\/(?:chat|generate)['"`]|:11434\/api\/(?:chat|generate)\b/ },
  { kind: 'argon', re: /\bARGON_DIRECTOR_URL\b/ },
];

export interface InventoryEntry {
  file: string;
  kind: CallKind;
  /** How many matching lines the file has. */
  count: number;
  audit: string;
  /** `adopted`: a row in rows.ts. `wrapper`: the shared request function itself, not a site. */
  status: 'adopted' | 'not-yet' | 'wrapper';
  /** The row (adopted) or the slice that will adopt it (not-yet), from AUDIT.md §4 "Work order". */
  by: string;
}

export const INVENTORY: readonly InventoryEntry[] = [
  // Adopted (G0).
  { file: 'lib/brand-studio/enhancer/index.ts', kind: 'gemini-json', count: 1, audit: '#1', status: 'adopted', by: 'brand-studio.enhancer' },
  { file: 'lib/brand-studio/director/compiler.ts', kind: 'gemini-json', count: 1, audit: '#2', status: 'adopted', by: 'brand-studio.director' },

  // The wrappers themselves (guarded through their callers).
  { file: 'lib/brand-studio/enhancer/gemini.ts', kind: 'gemini-generate', count: 1, audit: 'wrapper callGeminiJson', status: 'wrapper', by: '-' },
  { file: 'lib/template-director/flash-director.ts', kind: 'gemini-generate', count: 1, audit: 'wrapper callGeminiStructuredJson', status: 'wrapper', by: '-' },

  // Not yet adopted. `by` is the audit's slice; "(proposed)" where the audit's work order names none.
  { file: 'lib/brand-studio/director/analyzer.ts', kind: 'gemini-json', count: 1, audit: '#3', status: 'not-yet', by: 'S2 (proposed: feeds #2)' },
  { file: 'lib/brand-studio/director/analyzer.ts', kind: 'argon', count: 1, audit: '#4', status: 'not-yet', by: 'S2 (proposed: feeds #2)' },
  { file: 'lib/brand-studio/enhancer/blocked.ts', kind: 'gemini-json', count: 1, audit: '#5', status: 'not-yet', by: 'S2 (proposed: writes final_prompt, senior)' },
  { file: 'lib/brand-studio/revision/talk.ts', kind: 'gemini-json', count: 1, audit: '#6', status: 'not-yet', by: 'S3' },
  { file: 'lib/brand-studio/video/understand.ts', kind: 'gemini-json', count: 1, audit: 'VM-2 Batch B (guarded via brand-studio.video-understand)', status: 'not-yet', by: 'VM-2 Batch B (proof-table row pending)' },
  { file: 'lib/brand-studio/revision/advise.ts', kind: 'gemini-json', count: 1, audit: '#7', status: 'not-yet', by: 'S3' },
  { file: 'lib/brand-studio/revision/mark.ts', kind: 'gemini-json', count: 1, audit: '#8', status: 'not-yet', by: 'S3' },
  { file: 'lib/brand-studio/revision/clip.ts', kind: 'gemini-json', count: 1, audit: '#9', status: 'not-yet', by: 'S3 (proposed: feeds #6)' },
  { file: 'lib/brand-studio/revision/material.ts', kind: 'gemini-json', count: 1, audit: '#10', status: 'not-yet', by: 'S3 (proposed: revise family)' },
  { file: 'lib/brand-studio/film-sheet/index.ts', kind: 'gemini-json', count: 1, audit: '#11', status: 'not-yet', by: 'S2 (proposed: feeds #1/#2)' },
  { file: 'lib/brand-studio/edit-assist/service.ts', kind: 'gemini-json', count: 1, audit: '#12', status: 'not-yet', by: 'S2' },
  { file: 'lib/brand-studio/compose/service.ts', kind: 'gemini-json', count: 1, audit: '#13', status: 'not-yet', by: 'S1' },
  { file: 'lib/brand-studio/continuity/planner.ts', kind: 'gemini-json', count: 1, audit: '#14', status: 'not-yet', by: 'S2 (proposed)' },
  { file: 'lib/brand-studio/sound/architect.ts', kind: 'gemini-json', count: 1, audit: '#15', status: 'not-yet', by: 'S2' },
  { file: 'lib/brand-studio/sound/lyrics-draft.ts', kind: 'gemini-json', count: 1, audit: '#16', status: 'not-yet', by: 'S2' },
  { file: 'lib/brand-studio/sound/warnings.ts', kind: 'gemini-json', count: 1, audit: '#17 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/brand-studio/workflows/ai-builder.ts', kind: 'gemini-json', count: 1, audit: '#18', status: 'not-yet', by: 'S2' },
  { file: 'lib/brand-studio/workflows/consistency.ts', kind: 'gemini-json', count: 1, audit: '#19', status: 'not-yet', by: 'S2 (proposed)' },
  { file: 'lib/brand-studio/workflows/sheet-analysis.ts', kind: 'gemini-json', count: 1, audit: '#20 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/brand-studio/asset-role.ts', kind: 'gemini-json', count: 1, audit: '#21 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/template-director/flash-director.ts', kind: 'gemini-structured', count: 6, audit: '#22-#27 (#22-#24 Stage 1 chat; #25-#27 sealed or numbers)', status: 'not-yet', by: 'S4' },
  { file: 'lib/renders/partner-photo-check.ts', kind: 'gemini-structured', count: 1, audit: '#28 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/renders/pet-photo-check.ts', kind: 'gemini-structured', count: 1, audit: '#29 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/template-director/keyframes.ts', kind: 'gemini-generate', count: 1, audit: '#30', status: 'not-yet', by: 'S6 (with D4)' },
  { file: 'lib/identity/photo-check.ts', kind: 'gemini-generate', count: 1, audit: '#31 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/premium-editing/provider.ts', kind: 'openai', count: 1, audit: '#32 (no leak path)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/campaigns/risk/local-model.ts', kind: 'ollama', count: 1, audit: '#33 (staff only)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/influencers/local-vision.ts', kind: 'ollama', count: 1, audit: '#34 (staff only)', status: 'not-yet', by: 'S1 (request side only)' },
  { file: 'lib/images/gemini.ts', kind: 'gemini-interactions', count: 1, audit: '#35 (image generator, R10)', status: 'not-yet', by: 'S7' },
  { file: 'lib/images/openai.ts', kind: 'openai', count: 2, audit: '#36 (image generator, R10)', status: 'not-yet', by: 'S7' },
  { file: 'lib/images/seedream.ts', kind: 'openai', count: 1, audit: 'not in the audit table (image generator, R10; found by this grep)', status: 'not-yet', by: 'S7' },
];
