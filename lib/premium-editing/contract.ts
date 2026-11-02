/** Client-safe edit vocabulary. It contains no recipe, model instructions or allowance ledger. */
export const MAX_EDIT_TEXT_LENGTH = 800;
export const MAX_EDIT_REFERENCES = 3;
export const MAX_EDIT_REFERENCE_BYTES = 2 * 1024 * 1024;
export const MAX_SUBSCRIPTION_BODY_BYTES = 4 * 1024 * 1024;
export const EDIT_REFERENCE_RETENTION_DAYS = 7;
export const EDIT_SCOPES = ['wardrobe_color', 'prop_color', 'background_palette', 'lighting_mood'] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];
export const EDIT_COLORS = ['black', 'white', 'red', 'pink', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'beige', 'gray', 'gold', 'silver'] as const;
export const EDIT_PALETTES = ['warm', 'cool', 'neutral'] as const;
export const EDIT_MOODS = ['soft', 'bright', 'dramatic'] as const;
export const EDIT_VALUES = [...EDIT_COLORS, ...EDIT_PALETTES, ...EDIT_MOODS] as const;
export type EditValue = (typeof EDIT_VALUES)[number];
export interface EditChange { scope: EditScope; value: EditValue }
export type EditValidationCode = 'bad_edit' | 'edit_too_large' | 'edit_refused' | 'too_many_references' | 'bad_reference' | 'references_too_large' | 'reference_consent_required';
export interface EditReference { bytes: Uint8Array; mime: string }
export interface EditPlan {
  approved: boolean;
  refusal: 'none' | 'too_large' | 'identity' | 'unsupported' | 'unsafe';
  changes: EditChange[];
}
export interface PublicEditSummary {
  status: 'pending' | 'preparing' | 'prepared' | 'failed';
  changes: EditChange[];
  errorCode: string | null;
}
