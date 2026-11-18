/**
 * What the 1080p final of a draft takes ("draft to final", docs/BRAND-STUDIO-VIDEO-REMIX.md §2.3). One
 * figure for both places: `planFinal` (./plan.ts) reserves it and the draft's view carries it as
 * `finalEstimateKrw` (./repo.ts), so the figure on the button is the figure taken (owner rule 2026-11-18).
 *
 * 1080p for the draft job's seconds (else the draft's own length, else the model's default), with the
 * draft's reference video counted again for the exact length stored when the draft was planned
 * (docs.sunra.ai, "Draft mode"). Client-safe: no env, no db.
 */
import { estimateVideoUsd, type StudioVideoModel } from './models';
import type { StudioJobParams } from './types';
import { usageKrw } from './usage-rate';

export function finalPrice(input: {
  params: Partial<StudioJobParams> | null | undefined;
  /** The draft output's length in milliseconds, when known. */
  draftDurationMs: number | string | null | undefined;
  model: Pick<StudioVideoModel, 'defaultSeconds'>;
}): { usd: number; krw: number } {
  const p = input.params ?? {};
  const ms = input.draftDurationMs == null ? 0 : Number(input.draftDurationMs);
  const secs = p.seconds ?? (ms ? Math.round(ms / 1000) : input.model.defaultSeconds);
  const source = typeof p.referenceVideoSeconds === 'number' && Number.isFinite(p.referenceVideoSeconds) && p.referenceVideoSeconds > 0 ? p.referenceVideoSeconds : 0;
  const usd = estimateVideoUsd({ resolution: '1080p', seconds: secs, referenceVideoSeconds: source });
  return { usd, krw: usageKrw(usd, 'video') };
}
