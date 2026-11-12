/**
 * Pluggable Reference Music Provider Adapters (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Providers (`BRAND_STUDIO_MUSIC_PROVIDER`):
 * - `local_yue2`: Invokes WSL `scripts/mc generate` (ONLY when `BRAND_STUDIO_MUSIC_PROVIDER === 'local_yue2'`
 *   and `MUSIC_CREATOR_MC_SCRIPT` is configured, with `windowsHide: true` on Windows) or delegates to
 *   `YAGI_PRODUCTION_URL` (`studio: 'music'`); when neither local GPU worker nor external API key is
 *   configured, synthesizes a beat-accurate `-14 LUFS` 16-bit PCM WAV preview (`synth.ts`) so the studio
 *   works 100% end-to-end in local/preview/cloud out of the box.
 * - `yagi_production`: Workstation bridge (`studio: 'music'`, non-commercial draft license).
 * - `suno`: Commercial HTTP adapter (`SUNO_API_URL` + `SUNO_API_KEY`, `commercialAllowed: true`).
 * - `elevenlabs`: Commercial HTTP adapter (`ELEVENLABS_API_KEY`, `commercialAllowed: true`).
 * - `fake`: Deterministic instant WAV synthesis for tests and local zero-cost runs.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StudioErrorCode } from '@/lib/brand-studio/contracts';
import type { AudioAssetLicenseSource } from '@/lib/brands/sound/master';
import { MUSIC_PROVIDERS, type MusicProviderId } from './contracts';
import { synthesizePreviewMusicWav } from './synth';

const execFileAsync = promisify(execFile);

export type EnvRecord = Record<string, string | undefined>;

export interface MusicProviderSubmitRequest {
  stylePrompt: string;
  userPrompt: string;
  bpm: number;
  keySignature: string;
  durationSec: number;
  revealSec: number;
  preDropHushMs: number;
  abcNotation: string;
  refAudioUrl: string | null;
}

export type MusicProviderSubmitOutcome =
  | {
      ok: true;
      status: 'succeeded';
      bytes?: Uint8Array;
      audioUrl?: string;
      dataUrl?: string;
      mime: 'audio/wav' | 'audio/mpeg';
      commercialAllowed: boolean;
      licenseSource: AudioAssetLicenseSource;
      licenseCertificateRef?: string;
      synthesizedPreview: boolean;
    }
  | {
      ok: true;
      status: 'running';
      providerTaskId: string;
      commercialAllowed: boolean;
      licenseSource: AudioAssetLicenseSource;
      licenseCertificateRef?: string;
    }
  | {
      ok: false;
      code: StudioErrorCode;
    };

export type MusicProviderPollOutcome =
  | {
      ok: true;
      status: 'running';
    }
  | {
      ok: true;
      status: 'succeeded';
      bytes?: Uint8Array;
      audioUrl?: string;
      mime: 'audio/wav' | 'audio/mpeg';
    }
  | {
      ok: false;
      code: StudioErrorCode;
    };

export interface MusicProvider {
  readonly id: MusicProviderId;
  readonly commercialAllowed: boolean;
  submit(req: MusicProviderSubmitRequest): Promise<MusicProviderSubmitOutcome>;
  poll(providerTaskId: string): Promise<MusicProviderPollOutcome>;
}

export function resolveMusicProviderId(env: EnvRecord = process.env): MusicProviderId {
  const explicit = env.BRAND_STUDIO_MUSIC_PROVIDER?.trim();
  if (explicit && (MUSIC_PROVIDERS as readonly string[]).includes(explicit)) {
    return explicit as MusicProviderId;
  }
  if (env.SUNO_API_URL?.trim() && env.SUNO_API_KEY?.trim()) return 'suno';
  if (env.ELEVENLABS_API_KEY?.trim()) return 'elevenlabs';
  if (env.YAGI_PRODUCTION_URL?.trim() && env.YAGI_PROD_TOKEN?.trim()) return 'yagi_production';
  if (env.BRAND_STUDIO_PROVIDER?.trim() === 'fake' || env.NODE_ENV === 'test') return 'fake';
  return 'local_yue2';
}

function synthFallbackOutcome(req: MusicProviderSubmitRequest): MusicProviderSubmitOutcome {
  const wav = synthesizePreviewMusicWav({
    bpm: req.bpm,
    keySignature: req.keySignature,
    durationSec: req.durationSec,
    revealSec: req.revealSec,
    preDropHushMs: req.preDropHushMs,
  });
  return {
    ok: true,
    status: 'succeeded',
    bytes: wav.bytes,
    dataUrl: wav.dataUrl,
    mime: 'audio/wav',
    commercialAllowed: false,
    licenseSource: 'yue2_cc_by_nc',
    synthesizedPreview: true,
  };
}

function createFakeMusicProvider(env: EnvRecord): MusicProvider {
  return {
    id: 'fake',
    commercialAllowed: false,
    async submit(req) {
      if (env.BRAND_STUDIO_MUSIC_FAKE_FAIL === '1') {
        return { ok: false, code: 'provider_unavailable' };
      }
      return synthFallbackOutcome(req);
    },
    async poll() {
      const wav = synthesizePreviewMusicWav({
        bpm: 122,
        keySignature: 'Dm',
        durationSec: 8,
        revealSec: 2.5,
      });
      return {
        ok: true,
        status: 'succeeded',
        bytes: wav.bytes,
        mime: 'audio/wav',
      };
    },
  };
}

function createYagiProductionMusicProvider(env: EnvRecord, fetchImpl: typeof fetch): MusicProvider {
  const baseUrl = (env.YAGI_PRODUCTION_URL?.trim() || '').replace(/\/$/, '');
  const token = env.YAGI_PROD_TOKEN?.trim() || '';
  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  return {
    id: 'yagi_production',
    commercialAllowed: false,
    async submit(req) {
      if (!baseUrl || !token) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/api/production/jobs`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            studio: 'music',
            title: `Guide BGM (${req.bpm} BPM)`,
            params: {
              mode: 'bgm',
              style: req.stylePrompt,
              lyrics: '',
              ...(req.refAudioUrl ? { ref_audio: { url: req.refAudioUrl } } : {}),
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as {
          job?: { id?: string; status?: string; outputs?: Array<{ url?: string }> };
          id?: string;
        };
        const outUrl = data.job?.outputs?.[0]?.url;
        if (data.job?.status === 'done' && outUrl) {
          return {
            ok: true,
            status: 'succeeded',
            audioUrl: outUrl,
            mime: 'audio/mpeg',
            commercialAllowed: false,
            licenseSource: 'yue2_cc_by_nc',
            synthesizedPreview: false,
          };
        }
        const jobId = data.job?.id ?? data.id;
        if (jobId) {
          return {
            ok: true,
            status: 'running',
            providerTaskId: jobId,
            commercialAllowed: false,
            licenseSource: 'yue2_cc_by_nc',
          };
        }
        return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll(providerTaskId) {
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
        const st = data.job?.status;
        if (st === 'failed' || st === 'canceled') return { ok: false, code: 'failed' };
        const outUrl = data.job?.outputs?.[0]?.url;
        if (st === 'done' && outUrl) {
          return { ok: true, status: 'succeeded', audioUrl: outUrl, mime: 'audio/mpeg' };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

function createLocalYue2MusicProvider(env: EnvRecord, fetchImpl: typeof fetch): MusicProvider {
  const yagiBridge =
    env.YAGI_PRODUCTION_URL?.trim() && env.YAGI_PROD_TOKEN?.trim()
      ? createYagiProductionMusicProvider(env, fetchImpl)
      : null;

  return {
    id: 'local_yue2',
    commercialAllowed: false,
    async submit(req) {
      // Delegate to workstation HTTP bridge if configured
      if (yagiBridge) {
        const remote = await yagiBridge.submit(req);
        if (remote.ok) return remote;
      }

      // Invoke WSL `scripts/mc generate` ONLY when explicitly opted into `local_yue2` + script path
      const mcScript = env.MUSIC_CREATOR_MC_SCRIPT?.trim();
      if (env.BRAND_STUDIO_MUSIC_PROVIDER?.trim() === 'local_yue2' && mcScript) {
        try {
          const args =
            process.platform === 'win32'
              ? ['-d', 'Ubuntu-24.04', '--', mcScript, 'generate', '--style', req.stylePrompt, '--bgm']
              : ['generate', '--style', req.stylePrompt, '--bgm'];
          const bin = process.platform === 'win32' ? 'wsl.exe' : mcScript;
          const { stdout } = await execFileAsync(bin, args, {
            windowsHide: true,
            timeout: 25_000,
          });
          const parsed = JSON.parse(stdout.trim()) as { audioUrl?: string; taskId?: string };
          if (parsed.audioUrl) {
            return {
              ok: true,
              status: 'succeeded',
              audioUrl: parsed.audioUrl,
              mime: 'audio/wav',
              commercialAllowed: false,
              licenseSource: 'yue2_cc_by_nc',
              synthesizedPreview: false,
            };
          }
          if (parsed.taskId) {
            return {
              ok: true,
              status: 'running',
              providerTaskId: parsed.taskId,
              commercialAllowed: false,
              licenseSource: 'yue2_cc_by_nc',
            };
          }
        } catch {
          // Fall through cleanly to instant synthesized WAV preview when local GPU worker is offline
        }
      }

      return synthFallbackOutcome(req);
    },
    async poll(providerTaskId) {
      if (yagiBridge) {
        return yagiBridge.poll(providerTaskId);
      }
      return { ok: false, code: 'provider_unavailable' };
    },
  };
}

function createSunoMusicProvider(env: EnvRecord, fetchImpl: typeof fetch): MusicProvider {
  const baseUrl = (env.SUNO_API_URL?.trim() || '').replace(/\/$/, '');
  const apiKey = env.SUNO_API_KEY?.trim() || '';
  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });

  return {
    id: 'suno',
    commercialAllowed: true,
    async submit(req) {
      if (!baseUrl || !apiKey) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/generate`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            prompt: req.userPrompt || req.stylePrompt,
            style: req.stylePrompt,
            instrumental: true,
            bpm: req.bpm,
            key: req.keySignature,
            duration: req.durationSec,
            ...(req.refAudioUrl ? { ref_audio_url: req.refAudioUrl } : {}),
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
          id?: string;
          task_id?: string;
          status?: string;
          audio_url?: string;
          audioUrl?: string;
          url?: string;
        };
        const directUrl = data.audio_url ?? data.audioUrl ?? data.url;
        if (directUrl && data.status !== 'running' && data.status !== 'queued') {
          return {
            ok: true,
            status: 'succeeded',
            audioUrl: directUrl,
            mime: 'audio/mpeg',
            commercialAllowed: true,
            licenseSource: 'commercial_licensed',
            licenseCertificateRef: 'STUDIO-COMMERCIAL-SUNO-API',
            synthesizedPreview: false,
          };
        }
        const taskId = data.id ?? data.task_id;
        if (taskId) {
          return {
            ok: true,
            status: 'running',
            providerTaskId: taskId,
            commercialAllowed: true,
            licenseSource: 'commercial_licensed',
            licenseCertificateRef: 'STUDIO-COMMERCIAL-SUNO-API',
          };
        }
        return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll(providerTaskId) {
      if (!baseUrl || !apiKey) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(`${baseUrl}/jobs/${encodeURIComponent(providerTaskId)}`, {
          method: 'GET',
          headers: authHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, code: 'provider_unavailable' };
        const data = (await res.json()) as {
          status?: string;
          audio_url?: string;
          audioUrl?: string;
          url?: string;
        };
        if (data.status === 'failed' || data.status === 'error') {
          return { ok: false, code: 'failed' };
        }
        const directUrl = data.audio_url ?? data.audioUrl ?? data.url;
        if (directUrl && (data.status === 'succeeded' || data.status === 'complete' || data.status === 'completed')) {
          return {
            ok: true,
            status: 'succeeded',
            audioUrl: directUrl,
            mime: 'audio/mpeg',
          };
        }
        return { ok: true, status: 'running' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

function createElevenLabsMusicProvider(env: EnvRecord, fetchImpl: typeof fetch): MusicProvider {
  const endpoint = (
    env.ELEVENLABS_API_URL?.trim() || 'https://api.elevenlabs.io/v1/sound-generation'
  ).replace(/\/$/, '');
  const apiKey = env.ELEVENLABS_API_KEY?.trim() || '';

  return {
    id: 'elevenlabs',
    commercialAllowed: true,
    async submit(req) {
      if (!apiKey) return { ok: false, code: 'provider_unavailable' };
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text: req.userPrompt ? `${req.userPrompt} — ${req.stylePrompt}` : req.stylePrompt,
            duration_seconds: Math.min(22, req.durationSec),
          }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.status >= 400 && res.status < 500 ? 'provider_rejected' : 'provider_unavailable',
          };
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = (await res.json()) as { audio_url?: string; url?: string };
          const url = json.audio_url ?? json.url;
          if (!url) return { ok: false, code: 'provider_unavailable' };
          return {
            ok: true,
            status: 'succeeded',
            audioUrl: url,
            mime: 'audio/mpeg',
            commercialAllowed: true,
            licenseSource: 'commercial_licensed',
            licenseCertificateRef: 'STUDIO-COMMERCIAL-ELEVENLABS-API',
            synthesizedPreview: false,
          };
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return {
          ok: true,
          status: 'succeeded',
          bytes,
          mime: 'audio/mpeg',
          commercialAllowed: true,
          licenseSource: 'commercial_licensed',
          licenseCertificateRef: 'STUDIO-COMMERCIAL-ELEVENLABS-API',
          synthesizedPreview: false,
        };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
    },
    async poll() {
      return { ok: false, code: 'provider_unavailable' };
    },
  };
}

export function selectMusicProvider(
  env: EnvRecord = process.env,
  options?: { fetchImpl?: typeof fetch },
): MusicProvider {
  const id = resolveMusicProviderId(env);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  switch (id) {
    case 'fake':
      return createFakeMusicProvider(env);
    case 'local_yue2':
      return createLocalYue2MusicProvider(env, fetchImpl);
    case 'yagi_production':
      return createYagiProductionMusicProvider(env, fetchImpl);
    case 'suno':
      return createSunoMusicProvider(env, fetchImpl);
    case 'elevenlabs':
      return createElevenLabsMusicProvider(env, fetchImpl);
  }
}
