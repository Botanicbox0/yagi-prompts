/**
 * Pure data model for the shared process stage (campaign ops C1 §2.4).
 * Client-safe: no React, env, or db imports.
 */
export type ProcessPictureId =
  | 'c-brief'
  | 'c-template'
  | 'c-recruit'
  | 'c-pick'
  | 'c-post'
  | 'c-report'
  | 'p-request'
  | 'p-board'
  | 'p-draft'
  | 'p-revise'
  | 'p-done';

export interface ProcessStep {
  label: string;
  body: string;
  pictureId: ProcessPictureId;
}

export function nextStepIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}
