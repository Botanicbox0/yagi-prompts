import type {
  StudioAllowanceView,
  StudioAssetView,
  StudioJobView,
  StudioOutputView,
  StudioState,
} from "@/lib/brand-studio/contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** Valid RFC 9562 v4 ids (the contract parses ids with z.uuid()). */
export const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const ORG = id(0xa0);
export const copyFor = (locale: "ko" | "en") => getDictionary(locale).brandStudio;

export function output(n: number, patch: Partial<StudioOutputView> = {}): StudioOutputView {
  return {
    id: id(0x1000 + n),
    jobId: id(0x2000),
    kind: "image",
    url: `https://media.example/st/out-${n}.png`,
    thumbUrl: `https://media.example/st/out-${n}-thumb.webp`,
    width: 1600,
    height: 1200,
    seconds: null,
    draft: false,
    savedAssetId: null,
    createdAt: "2026-11-10T01:00:00Z",
    ...patch,
  };
}

export function job(n: number, patch: Partial<StudioJobView> = {}): StudioJobView {
  return {
    id: id(0x2000 + n),
    kind: "image",
    status: "succeeded",
    model: "seedream-5-pro",
    prompt: `Prompt ${n}`,
    finalPrompt: `Enhanced prompt ${n}`,
    expected: 1,
    aspect: "4:3",
    resolution: "2K",
    seconds: null,
    audio: null,
    references: [],
    parentOutputId: null,
    parentAssetId: null,
    box: null,
    method: null,
    keep: [],
    change: null,
    outputs: [],
    estimateKrw: 0,
    errorCode: null,
    createdAt: `2026-11-10T0${n % 10}:00:00Z`,
    finishedAt: null,
    ...patch,
  };
}

export function asset(n: number, patch: Partial<StudioAssetView> = {}): StudioAssetView {
  return {
    id: id(0x3000 + n),
    kind: "image",
    role: null,
    name: `Asset ${n}`,
    tags: [],
    url: `https://media.example/st/asset-${n}.png`,
    thumbUrl: `https://media.example/st/asset-${n}-thumb.webp`,
    width: 1200,
    height: 1200,
    seconds: null,
    source: "upload",
    createdAt: "2026-11-09T00:00:00Z",
    ...patch,
  };
}

export const allowance = (patch: Partial<StudioAllowanceView> = {}): StudioAllowanceView => ({
  capKrw: 300_000,
  usedKrw: 12_400,
  resetsAt: "2026-11-30T15:00:00Z",
  ...patch,
});

export function studioState(patch: Partial<StudioState> = {}): StudioState {
  return { ok: true, canCreate: true, allowance: allowance(), assets: [], jobs: [], campaigns: [], ...patch };
}
