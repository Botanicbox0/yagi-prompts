/**
 * "캠페인으로 보내기" (docs/BRAND-STUDIO-V2.md §10): one result or library file goes to a campaign,
 * an existing one or a new request with just a title and a goal. The campaign side is the existing
 * workspace service: `createBrandProject`, then the attachment reserve -> put -> complete flow. Its own
 * membership and write checks run again there; the studio only adds its seat and feature gate first.
 *
 * `asFormat` (a video the brand wants creators to follow): a new campaign's goal gains one sentence
 * saying so; an existing campaign gets a brand message on its thread, the channel the studio team
 * already watches. Both sentences come from the dictionaries (`brandStudio.handoff`), in the sender's
 * language, the way other server-composed brand text in this repo does (lib/brands/schemas.ts).
 */
import type { Viewer } from '@/lib/auth/identity';
import {
  completeBrandAttachment,
  createBrandProject,
  reserveBrandAttachment,
  sendBrandMessage,
} from '@/lib/brands/workspace/service';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BRAND_ATTACHMENT_LIMITS, type BrandAttachmentMime } from '@/lib/brands/workspace/schemas';
import type { BrandFailureCode } from '@/lib/brands/workspace/types';
import { CampaignHandoffSchema, type StudioErrorCode, type StudioFailure, type StudioHandoffDone } from './contracts';
import { requireCreate, studioSeat, StudioDenied } from './access';
import { derivedUuid, failure, guarded } from './outcome';
import { readyAsset, readyOutput } from './repo';
import type { StudioDeps } from './types';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };

function mapWorkspaceCode(code: BrandFailureCode): StudioErrorCode {
  switch (code) {
    case 'sign_in_required':
    case 'forbidden':
    case 'not_found':
    case 'invalid':
    case 'conflict':
    case 'feature_unavailable':
      return code;
    case 'rate_limited':
      return 'too_many_running';
    default:
      return 'failed';
  }
}

const OBJECTIVE_MAX = 2000;

/** The goal as typed, then the format sentence; the typed part gives way so the whole fits. */
export function objectiveWithFormat(objective: string, sentence: string): string {
  const room = OBJECTIVE_MAX - sentence.length - 2;
  return `${objective.slice(0, Math.max(0, room)).trimEnd()}

${sentence}`;
}

function fileName(name: string, mime: string): string {
  const base = name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'studio';
  return `${base}.${EXT[mime] ?? 'bin'}`;
}

export async function handoffToCampaign(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioHandoffDone | StudioFailure> {
  const parsed = CampaignHandoffSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const source = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      let file: { key: string; mime: string; name: string; size: number; kind: 'image' | 'video' | 'audio' } | null = null;
      if (v.assetId) {
        const a = await readyAsset(sql, v.organizationId, v.assetId);
        if (a) file = { key: a.storage_key, mime: a.mime, name: a.name, size: Number(a.size_bytes), kind: a.kind };
      } else {
        const o = await readyOutput(sql, v.organizationId, v.outputId!);
        if (o?.storage_key && o.mime) file = { key: o.storage_key, mime: o.mime, name: `studio-${o.id.slice(0, 8)}`, size: Number(o.bytes ?? 0), kind: o.kind };
      }
      if (!file) throw new StudioDenied('not_found');
      if (v.projectId) {
        const project = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2 and client_visible', [v.projectId, v.organizationId])).rows[0];
        if (!project) throw new StudioDenied('not_found');
      }
      return file;
    }),
  );
  if ('ok' in source) return source;
  const limit = BRAND_ATTACHMENT_LIMITS[source.mime as BrandAttachmentMime];
  if (!limit || !EXT[source.mime]) return failure('unsupported_file');
  if (source.size > limit) return failure('file_too_large');
  // Only a video can be a format; a picture keeps today's plain handoff whatever the flag says.
  const asFormat = v.asFormat && source.kind === 'video';
  const words = getDictionary(viewer.locale === 'en' ? 'en' : 'ko').brandStudio.handoff;

  let projectId = v.projectId ?? null;
  if (!projectId) {
    const created = await createBrandProject({ sql: deps.sql }, viewer, {
      organizationId: v.organizationId,
      requestId: derivedUuid('brand-studio-handoff-project', v.organizationId, viewer.userId ?? '', v.requestId),
      title: v.newProject!.title,
      objective: asFormat ? objectiveWithFormat(v.newProject!.objective, words.formatObjective) : v.newProject!.objective,
      budgetKrw: null,
      productionMode: 'creator',
    });
    if (!created.ok) return failure(mapWorkspaceCode(created.code));
    projectId = created.id;
  }

  const fileRequestId = derivedUuid('brand-studio-handoff-file', projectId, viewer.userId ?? '', v.requestId);
  // A retry of a handoff that already landed: the file is there, nothing to copy again.
  const landed = (
    await deps.sql.query("select 1 from brand_attachments where project_id = $1 and created_by = $2 and request_id = $3 and status = 'ready'", [projectId, viewer.userId, fileRequestId])
  ).rows[0];
  if (landed) {
    if (asFormat && v.projectId) await tellStudio(deps, viewer, projectId, v.requestId, words.formatMessage);
    return { ok: true, projectId, href: `/brand/projects/${projectId}` };
  }
  const bytes = await deps.media.read(source.key);
  const reserved = await reserveBrandAttachment({ sql: deps.sql }, viewer, {
    projectId,
    requestId: fileRequestId,
    name: fileName(source.name, source.mime),
    mime: source.mime,
    sizeBytes: bytes.byteLength,
  });
  if (!reserved.ok) return failure(mapWorkspaceCode(reserved.code));
  await deps.staging.putStaging(reserved.storageKey, bytes, source.mime);
  const completed = await completeBrandAttachment({ sql: deps.sql, storage: deps.staging }, viewer, reserved.id);
  if (!completed.ok) return failure(mapWorkspaceCode(completed.code));
  if (asFormat && v.projectId) await tellStudio(deps, viewer, projectId, v.requestId, words.formatMessage);
  return { ok: true, projectId, href: `/brand/projects/${projectId}` };
}

/**
 * A brand message on an existing campaign's thread (the workspace's own `message.send`), so the studio
 * team is told a format video arrived. Idempotent per handoff; a refusal (e.g. the thread's rate limit)
 * does not undo a file that already landed, so it is logged and the handoff still succeeds.
 */
async function tellStudio(deps: StudioDeps, viewer: Viewer, projectId: string, requestId: string, body: string): Promise<void> {
  const sent = await sendBrandMessage({ sql: deps.sql }, viewer, {
    projectId,
    requestId: derivedUuid('brand-studio-handoff-format', projectId, viewer.userId ?? '', requestId),
    body,
  });
  if (!sent.ok) deps.log?.('studio_handoff_message_failed', { projectId, code: sent.code });
}
