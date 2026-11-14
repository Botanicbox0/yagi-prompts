/**
 * Pluggable SeedVR2 upscale provider adapters (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Note: BytePlus ModelArk API does not expose a SeedVR2 endpoint; ComfyUI Cloud / external API plugs
 * straight in via `COMFYUI_CLOUD_URL` / `BRAND_STUDIO_UPSCALE_API_URL` without code changes.
 * Any Windows subprocess helper must pass `windowsHide: true` (Quiet Windows automation).
 */
import sharp from 'sharp';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import type { StudioErrorCode } from '@/lib/brand-studio/contracts';
import type { SeedVr2UpscaleConfig, UpscaleSegment } from '@/lib/brands/finish/upscale-master';
import {
  UPSCALE_PROVIDERS,
  type UpscaleMediaKind,
  type UpscaleProviderId,
  type UpscaleResolution,
} from './contracts';

export type EnvRecord = Record<string, string | undefined>;

export interface UpscaleProviderSubmitRequest {
  kind: UpscaleMediaKind;
  resolution: UpscaleResolution;
  durationSec: number;
  sourceUrl: string | null;
  sourceBytes?: Uint8Array | null;
  config: SeedVr2UpscaleConfig;
  segments: readonly UpscaleSegment[];
}

export type UpscaleProviderSubmitOutcome =
  | {
      ok: true;
      status: 'succeeded';
      bytes?: Uint8Array;
      outputUrl?: string;
      mime: string;
      width: number;
      height: number;
    }
  | {
      ok: true;
      status: 'running';
      providerTaskId: string;
    }
  | {
      ok: false;
      code: StudioErrorCode;
      detail?: string;
    };

export type UpscaleProviderPollOutcome =
  | {
      ok: true;
      status: 'running';
    }
  | {
      ok: true;
      status: 'succeeded';
      bytes?: Uint8Array;
      outputUrl?: string;
      mime: string;
      width: number;
      height: number;
    }
  | {
      ok: false;
      code: StudioErrorCode;
      detail?: string;
    };

export interface UpscaleProvider {
  readonly id: UpscaleProviderId;
  submit(req: UpscaleProviderSubmitRequest): Promise<UpscaleProviderSubmitOutcome>;
  poll(providerTaskId: string, meta: { kind: UpscaleMediaKind; resolution: UpscaleResolution }): Promise<UpscaleProviderPollOutcome>;
}

const LOCAL_COMFYUI_DEFAULT_URL = 'http://127.0.0.1:8188';
const LOCAL_PROBE_TIMEOUT_MS = 1200;

export const QUIET_SUBPROCESS_OPTS = { windowsHide: true } as const;

export function dimensionsForUpscale(
  resolution: UpscaleResolution,
): { width: number; height: number } {
  // Short-edge pixel count (`1080` -> `1080x1920`, `1440` -> `1440x2560`, `2160` -> `2160x3840`)
  const width = resolution;
  const height = Math.round((resolution * 16) / 9);
  return { width, height };
}

/**
 * Resolves the active upscale provider from environment variables:
 * 1. Explicit `BRAND_STUDIO_UPSCALE_PROVIDER`
 * 2. `BRAND_STUDIO_UPSCALE_API_URL` -> `'external_api'`
 * 3. `COMFYUI_CLOUD_URL` -> `'comfyui_cloud'`
 * 4. `YAGI_PRODUCTION_URL` + `YAGI_PROD_TOKEN` -> `'yagi_production'`
 * 5. `COMFYUI_API_URL` -> `'local_comfyui'`
 * 6. Test / `BRAND_STUDIO_PROVIDER=fake` -> `'fake'`
 * 7. Default -> `'local_comfyui'`
 */
export function resolveUpscaleProviderId(env: EnvRecord = process.env): UpscaleProviderId {
  const explicit = env.BRAND_STUDIO_UPSCALE_PROVIDER?.trim();
  if (explicit && (UPSCALE_PROVIDERS as readonly string[]).includes(explicit)) {
    return explicit as UpscaleProviderId;
  }
  if (env.BRAND_STUDIO_UPSCALE_API_URL?.trim()) return 'external_api';
  if (env.COMFYUI_CLOUD_URL?.trim()) return 'comfyui_cloud';
  if (env.YAGI_PRODUCTION_URL?.trim() && env.YAGI_PROD_TOKEN?.trim()) return 'yagi_production';
  if (env.COMFYUI_API_URL?.trim()) return 'local_comfyui';
  if (env.BRAND_STUDIO_PROVIDER?.trim() === 'fake' || env.NODE_ENV === 'test') return 'fake';
  return 'local_comfyui';
}

/**
 * Probes local ComfyUI `/system_stats` with a strict `1.2s` timeout so cloud/offline environments
 * fail fast and trigger an immediate 100% credit refund without hanging.
 */
export async function probeLocalComfyUi(
  env: EnvRecord = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ online: boolean; baseUrl: string }> {
  const baseUrl = (env.COMFYUI_API_URL?.trim() || LOCAL_COMFYUI_DEFAULT_URL).replace(/\/$/, '');
  try {
    const res = await fetchImpl(`${baseUrl}/system_stats`, {
      method: 'GET',
      signal: AbortSignal.timeout(LOCAL_PROBE_TIMEOUT_MS),
    });
    return { online: res.ok, baseUrl };
  } catch {
    return { online: false, baseUrl };
  }
}

/**
 * Builds the canonical SeedVR2 ComfyUI workflow graph payload (`seedvr2_ema_7b_fp16.safetensors`,
 * `batch_size: 21`, `color_correction: 'lab'`, `temporal_overlap: 2`).
 */
export function buildSeedVr2WorkflowPayload(req: UpscaleProviderSubmitRequest): Record<string, unknown> {
  return {
    model: req.config.ditModel,
    vae: req.config.vaeModel,
    kind: req.kind,
    resolution: req.resolution,
    batch_size: req.config.batchSize,
    uniform_batch_size: req.config.uniformBatchSize,
    temporal_overlap: req.config.temporalOverlap,
    color_correction: req.config.colorCorrection,
    offload_device: req.config.offloadDevice,
    color_space: req.config.colorSpaceTag,
    source_url: req.sourceUrl,
    segments: req.segments.map((s) => ({
      index: s.index,
      start_sec: s.startSec,
      end_sec: s.endSec,
      duration_sec: s.durationSec,
    })),
  };
}

function createFakeUpscaleProvider(env: EnvRecord): UpscaleProvider {
  return {
    id: 'fake',
    async submit(req) {
      if (env.BRAND_STUDIO_UPSCALE_FAKE_FAIL === '1') {
        return { ok: false, code: 'provider_unavailable', detail: 'simulated_fake_failure' };
      }
      const { width, height } = dimensionsForUpscale(req.resolution);
      if (req.kind === 'image') {
        // Generate compact real PNG header with deterministic colour tag per resolution
        const previewW = Math.min(64, width);
        const previewH = Math.min(114, height);
        const bytes = new Uint8Array(
          await sharp({
            create: {
              width: previewW,
              height: previewH,
              channels: 3,
              background: { r: 24, g: 56, b: req.resolution === 2160 ? 220 : 160 },
            },
          })
            .png()
            .toBuffer(),
        );
        return {
          ok: true,
          status: 'succeeded',
          bytes,
          mime: 'image/png',
          width,
          height,
        };
      }

      const frameCount = Math.max(1, req.segments.length);
      const samples = Array.from({ length: frameCount }, (_, idx) => ({
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, idx & 0xff]),
        isKeyFrame: idx === 0,
      }));
      const mp4 = muxAvc1ToMp4({
        width,
        height,
        fps: 24,
        videoSamples: samples,
      });
      return {
        ok: true,
        status: 'succeeded',
        bytes: mp4,
        mime: 'video/mp4',
        width,
        height,
      };
    },
    async poll(_taskId, meta) {
      const { width, height } = dimensionsForUpscale(meta.resolution);
      return {
        ok: true,
        status: 'succeeded',
        bytes: muxAvc1ToMp4({
          width,
          height,
          fps: 24,
          videoSamples: [{ data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]), isKeyFrame: true }],
        }),
        mime: meta.kind === 'image' ? 'image/png' : 'video/mp4',
        width,
        height,
      };
    },
  };
}

function createLocalComfyUiProvider(env: EnvRecord, fetchImpl: typeof fetch): UpscaleProvider {
  return {
    id: 'local_comfyui',
    async submit(req) {
      const probe = await probeLocalComfyUi(env, fetchImpl);
      if (!probe.online) {
        return { ok: false, code: 'provider_unavailable', detail: 'local_worker_offline' };
      }
      try {
        const res = await fetchImpl(`${probe.baseUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: buildSeedVr2WorkflowPayload(req),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return { ok: false, code: 'provider_unavailable', detail: `http_${res.status}` };
        }
        const json = (await res.json()) as {
          prompt_id?: string;
          output_url?: string;
        };
        const { width, height } = dimensionsForUpscale(req.resolution);
        if (json.output_url) {
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: json.output_url,
            mime: req.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        if (json.prompt_id) {
          return { ok: true, status: 'running', providerTaskId: json.prompt_id };
        }
        return { ok: false, code: 'provider_unavailable', detail: 'missing_prompt_id' };
      } catch {
        return { ok: false, code: 'provider_unavailable', detail: 'local_request_failed' };
      }
    },
    async poll(providerTaskId, meta) {
      const baseUrl = (env.COMFYUI_API_URL?.trim() || LOCAL_COMFYUI_DEFAULT_URL).replace(/\/$/, '');
      try {
        const res = await fetchImpl(`${baseUrl}/history/${encodeURIComponent(providerTaskId)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const json = (await res.json()) as Record<string, { status?: { status_str?: string }; output_url?: string }>;
        const entry = json[providerTaskId];
        if (!entry) return { ok: true, status: 'running' };
        if (entry.status?.status_str === 'error') {
          return { ok: false, code: 'failed' };
        }
        if (entry.output_url) {
          const { width, height } = dimensionsForUpscale(meta.resolution);
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: entry.output_url,
            mime: meta.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

function createComfyUiCloudProvider(env: EnvRecord, fetchImpl: typeof fetch): UpscaleProvider {
  const baseUrl = (env.COMFYUI_CLOUD_URL?.trim() || '').replace(/\/$/, '');
  const apiKey = env.COMFYUI_CLOUD_API_KEY?.trim() || '';
  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });

  return {
    id: 'comfyui_cloud',
    async submit(req) {
      if (!baseUrl) return { ok: false, code: 'provider_unavailable', detail: 'cloud_url_missing' };
      try {
        const res = await fetchImpl(`${baseUrl}/api/prompt`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            workflow: 'seedvr2_upscale',
            ...buildSeedVr2WorkflowPayload(req),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.status >= 400 && res.status < 500 ? 'provider_rejected' : 'provider_unavailable',
          };
        }
        const data = (await res.json()) as {
          prompt_id?: string;
          task_id?: string;
          output_url?: string;
          url?: string;
        };
        const { width, height } = dimensionsForUpscale(req.resolution);
        const directUrl = data.output_url ?? data.url;
        if (directUrl) {
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: directUrl,
            mime: req.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        const taskId = data.prompt_id ?? data.task_id;
        if (taskId) {
          return { ok: true, status: 'running', providerTaskId: taskId };
        }
        return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll(providerTaskId, meta) {
      if (!baseUrl) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/api/jobs/${encodeURIComponent(providerTaskId)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as {
          status?: string;
          output_url?: string;
          url?: string;
        };
        if (data.status === 'failed' || data.status === 'error') {
          return { ok: false, code: 'failed' };
        }
        const directUrl = data.output_url ?? data.url;
        if ((data.status === 'succeeded' || data.status === 'completed' || data.status === 'done') && directUrl) {
          const { width, height } = dimensionsForUpscale(meta.resolution);
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: directUrl,
            mime: meta.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

function createExternalApiProvider(env: EnvRecord, fetchImpl: typeof fetch): UpscaleProvider {
  const endpoint = (env.BRAND_STUDIO_UPSCALE_API_URL?.trim() || '').replace(/\/$/, '');
  const apiKey = env.BRAND_STUDIO_UPSCALE_API_KEY?.trim() || '';
  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });

  return {
    id: 'external_api',
    async submit(req) {
      if (!endpoint) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(buildSeedVr2WorkflowPayload(req)),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.status >= 400 && res.status < 500 ? 'provider_rejected' : 'provider_unavailable',
          };
        }
        const data = (await res.json()) as {
          status?: string;
          taskId?: string;
          jobId?: string;
          outputUrl?: string;
          url?: string;
        };
        const { width, height } = dimensionsForUpscale(req.resolution);
        const directUrl = data.outputUrl ?? data.url;
        if (directUrl && data.status !== 'running' && data.status !== 'queued') {
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: directUrl,
            mime: req.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        const taskId = data.taskId ?? data.jobId;
        if (taskId) {
          return { ok: true, status: 'running', providerTaskId: taskId };
        }
        return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll(providerTaskId, meta) {
      if (!endpoint) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${endpoint}/${encodeURIComponent(providerTaskId)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as { status?: string; outputUrl?: string; url?: string };
        if (data.status === 'failed' || data.status === 'error') {
          return { ok: false, code: 'failed' };
        }
        const directUrl = data.outputUrl ?? data.url;
        if (directUrl && (data.status === 'succeeded' || data.status === 'done' || data.status === 'completed')) {
          const { width, height } = dimensionsForUpscale(meta.resolution);
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: directUrl,
            mime: meta.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

function createYagiProductionUpscaleProvider(env: EnvRecord, fetchImpl: typeof fetch): UpscaleProvider {
  const baseUrl = (env.YAGI_PRODUCTION_URL?.trim() || '').replace(/\/$/, '');
  const token = env.YAGI_PROD_TOKEN?.trim() || '';
  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  return {
    id: 'yagi_production',
    async submit(req) {
      if (!baseUrl || !token) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/api/production/jobs`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            studio: 'upscale',
            title: `HD ${req.resolution}p`,
            source: req.sourceUrl ? { url: req.sourceUrl } : undefined,
            params: {
              resolution: req.resolution,
              dit_model: req.config.ditModel,
              batch_size: req.config.batchSize,
              color_correction: req.config.colorCorrection,
              segments: req.segments,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as {
          job?: { id?: string; status?: string; outputs?: Array<{ url?: string }> };
          id?: string;
        };
        const job = data.job;
        const firstUrl = job?.outputs?.[0]?.url;
        const { width, height } = dimensionsForUpscale(req.resolution);
        if (job?.status === 'done' && firstUrl) {
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: firstUrl,
            mime: req.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        const jobId = job?.id ?? data.id;
        if (jobId) {
          return { ok: true, status: 'running', providerTaskId: jobId };
        }
        return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll(providerTaskId, meta) {
      if (!baseUrl || !token) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/api/production/jobs/${encodeURIComponent(providerTaskId)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as {
          job?: { status?: string; outputs?: Array<{ url?: string }> };
        };
        const status = data.job?.status;
        if (status === 'failed' || status === 'canceled') {
          return { ok: false, code: 'failed' };
        }
        const firstUrl = data.job?.outputs?.[0]?.url;
        if (status === 'done' && firstUrl) {
          const { width, height } = dimensionsForUpscale(meta.resolution);
          return {
            ok: true,
            status: 'succeeded',
            outputUrl: firstUrl,
            mime: meta.kind === 'image' ? 'image/png' : 'video/mp4',
            width,
            height,
          };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

export function selectUpscaleProvider(
  env: EnvRecord = process.env,
  options?: { fetchImpl?: typeof fetch },
): UpscaleProvider {
  const id = resolveUpscaleProviderId(env);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  switch (id) {
    case 'fake':
      return createFakeUpscaleProvider(env);
    case 'local_comfyui':
      return createLocalComfyUiProvider(env, fetchImpl);
    case 'comfyui_cloud':
      return createComfyUiCloudProvider(env, fetchImpl);
    case 'external_api':
      return createExternalApiProvider(env, fetchImpl);
    case 'yagi_production':
      return createYagiProductionUpscaleProvider(env, fetchImpl);
  }
}
