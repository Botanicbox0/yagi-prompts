/**
 * The sound studio's music engine adapter (docs/BRAND-SOUND-STUDIO.md §7.1). Screens and job rows never
 * know which engine made a track: they read `capabilities` to decide which controls to draw, and the job
 * row keeps the engine id the run was made with. Swapping the engine is one file under `engines/` and one
 * line in `MUSIC_ENGINES`; `BRAND_SOUND_MUSIC_ENGINE` (server only) picks it, default `suno-v6-sunra`.
 *
 * How it plugs into the studio: an engine only knows its price and its request shape. Sending, polling,
 * webhooks, leases, the API-lane balance failover and downloads stay the studio's own (../engine.ts,
 * ../provider/*), exactly as for images and video, so the fake provider in local mode and tests runs the
 * same adapter with no network and no money.
 *
 * Client-safe: no env, no db, no fetch.
 */
import type { StudioProviderRequest } from '../provider/types';
import { sunoV6Sunra } from './engines/suno-sunra';

export type MusicMode = 'describe' | 'custom';

export interface MusicRequest {
  mode: MusicMode;
  /** What is sent: the description (describe mode) or the style line (custom mode). */
  prompt: string;
  /** False: instrumental. */
  vocal: boolean;
  /** Custom mode only. */
  title?: string;
  lyrics?: string;
  /** "더 고르게 만들기": more compute, twice the price (custom mode only). */
  careful?: boolean;
}

export interface MusicEngineCapabilities {
  /** False: the engine cannot be asked for a length; the length tool fits it afterwards (§4.3). */
  lengthInput: false | { min: number; max: number };
  vocals: boolean;
  lyrics: boolean;
  /** A "spend more for a steadier song" switch (Max Mode). */
  careful: boolean;
  extend: boolean;
  inpaint: boolean;
  stems: boolean;
  /** Engine input limits, in characters. */
  limits: { prompt: number; style: number; title: number; lyrics: number };
}

export interface MusicEngine {
  id: string;
  /** What `brand_studio_jobs.model` holds; the lane router reads `mcp` (null: API lane only). */
  model: { id: string; mcp: null };
  capabilities: MusicEngineCapabilities;
  /** The provider's list price for one request, in USD (rounded up to the cent as billed). */
  quoteUsd(request: MusicRequest): number;
  /** The exact provider request. Throws on a request the engine cannot take. */
  request(request: MusicRequest): StudioProviderRequest;
}

export const MUSIC_ENGINES: Readonly<Record<string, MusicEngine>> = {
  [sunoV6Sunra.id]: sunoV6Sunra,
};

export const DEFAULT_MUSIC_ENGINE = sunoV6Sunra.id;

/** The engine for this environment: `BRAND_SOUND_MUSIC_ENGINE` when it names a known one, else the default. */
export function musicEngine(env: Record<string, string | undefined> = {}): MusicEngine {
  const picked = env.BRAND_SOUND_MUSIC_ENGINE?.trim();
  return (picked && MUSIC_ENGINES[picked]) || MUSIC_ENGINES[DEFAULT_MUSIC_ENGINE]!;
}

/** The engine that made a stored job (by the model id on the row), or null. */
export function musicEngineOfModel(modelId: string): MusicEngine | null {
  return Object.values(MUSIC_ENGINES).find((engine) => engine.model.id === modelId) ?? null;
}
