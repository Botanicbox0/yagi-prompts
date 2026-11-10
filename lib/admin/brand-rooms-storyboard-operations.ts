import { STAGING_BUCKET } from '@/lib/storage';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import {
  staffCreateStoryboard,
  staffDeleteStoryboard,
  staffNewVersion,
  staffReplaceFrames,
  staffShareStoryboard,
  staffUpdateStoryboard,
  type StaffFrameEntry,
  type StoryboardDeps,
} from '@/lib/brand-rooms/storyboards';
import { STORYBOARD_ADMIN_PATH, STORYBOARD_LIMITS, storyboardAdminHref, type FrameTextInput } from '@/lib/brand-rooms/storyboard-contracts';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import * as f from './form';

/**
 * Project room storyboards, the team side (docs/BRAND-ROOMS.md §5, §9-2). The list and the editor live
 * on `/admin/brand-rooms/storyboards` and its detail page. Each service call re-reads the admin flag on
 * the profile row inside its transaction and refuses a sandboxed organization; boards made here carry
 * `created_role = 'studio'` and the writer's id — the rows are the audit.
 *
 * Pictures for `.frames`: in production the editor uploads each file to a signed staging address
 * (`/api/admin/staging-url`) and sends the key (`staging:<key>`); locally it posts the file in the same
 * form (`file:<field>`). Either way the service checks the bytes before anything is stored.
 */

const deps = (ctx: AdminContext): StoryboardDeps => ({ sql: ctx.sql, media: createStudioMediaStore(), staging: ctx.storage });

function storyboardFailure(code: string) {
  const admin =
    code === 'not_found'
      ? 'notFound'
      : code === 'forbidden' || code === 'sign_in_required'
        ? 'forbidden'
        : code === 'conflict' || code === 'not_editable'
          ? 'brandConflict'
          : code === 'unsupported_file' || code === 'file_too_large'
            ? 'upload'
            : 'invalid';
  return fail(admin, code);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only keys `/api/admin/staging-url` mints; anything else in the bucket is out of reach. */
const STAGING_KEY = /^content\/prompt\/upload\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

const ref = (form: FormData) => ({ storyboardId: f.str(form, 'storyboardId') });

const create: AdminOperation<{ projectId: string; title: string }> = {
  parse: (form) => ({ ok: true, value: { projectId: f.str(form, 'projectId'), title: f.str(form, 'title') } }),
  async run(ctx, input) {
    const result = await staffCreateStoryboard(deps(ctx), ctx.viewer, input);
    if (!result.ok) return storyboardFailure(result.code);
    return ok('created', { to: storyboardAdminHref(result.board.id) });
  },
};

const update: AdminOperation<{ storyboardId: string; title: string }> = {
  parse: (form) => ({ ok: true, value: { ...ref(form), title: f.str(form, 'title') } }),
  async run(ctx, input) {
    const result = await staffUpdateStoryboard(deps(ctx), ctx.viewer, input);
    if (!result.ok) return storyboardFailure(result.code);
    return ok('saved', { to: storyboardAdminHref(input.storyboardId) });
  },
};

type PictureSource = { staging: string } | { file: File };

interface FramesInput {
  storyboardId: string;
  title: string;
  entries: Array<{ id?: string; picture?: PictureSource; text: FrameTextInput }>;
}

/** The editor's whole save: `frames` is JSON, `[{ id? | upload, scene, shot, description, camera, audio, seconds }]`. */
const frames: AdminOperation<FramesInput> = {
  parse(form) {
    let list: unknown;
    try {
      list = JSON.parse(f.str(form, 'frames') || '[]');
    } catch {
      return { ok: false, detail: 'frames must be JSON' };
    }
    if (!Array.isArray(list)) return { ok: false, detail: 'frames must be a list' };
    if (list.length > STORYBOARD_LIMITS.framesPerBoard) return { ok: false, detail: `at most ${STORYBOARD_LIMITS.framesPerBoard} cuts` };
    const entries: FramesInput['entries'] = [];
    for (const raw of list as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') return { ok: false, detail: 'each cut is an object' };
      const text: FrameTextInput = {};
      for (const key of ['scene', 'shot', 'description', 'camera', 'audio'] as const) {
        const value = raw[key];
        if (value === null || typeof value === 'string') text[key] = value as never;
      }
      if (raw.seconds === null || typeof raw.seconds === 'number') text.seconds = raw.seconds as number | null;
      const upload = typeof raw.upload === 'string' ? raw.upload : '';
      if (upload.startsWith('staging:')) {
        const key = upload.slice('staging:'.length);
        if (!STAGING_KEY.test(key)) return { ok: false, detail: 'unknown staging key' };
        entries.push({ picture: { staging: key }, text });
      } else if (upload.startsWith('file:')) {
        const posted = f.file(form, upload.slice('file:'.length));
        if (!posted) return { ok: false, detail: 'a posted picture is missing' };
        entries.push({ picture: { file: posted }, text });
      } else if (typeof raw.id === 'string' && UUID.test(raw.id)) {
        entries.push({ id: raw.id, text });
      } else {
        return { ok: false, detail: 'each cut needs an id or an upload' };
      }
    }
    return { ok: true, value: { ...ref(form), title: f.str(form, 'title'), entries } };
  },
  async run(ctx, input) {
    const list: StaffFrameEntry[] = [];
    for (const entry of input.entries) {
      if (!entry.picture) {
        list.push({ id: entry.id, text: entry.text });
        continue;
      }
      try {
        if ('file' in entry.picture) {
          if (entry.picture.file.size > STORYBOARD_LIMITS.imageBytesMax) return fail('upload', 'file_too_large');
          list.push({ picture: new Uint8Array(await entry.picture.file.arrayBuffer()), text: entry.text });
        } else {
          list.push({ picture: await ctx.storage.read(STAGING_BUCKET, entry.picture.staging), text: entry.text });
        }
      } catch {
        return fail('upload', 'picture_unreadable');
      }
    }
    const result = await staffReplaceFrames(deps(ctx), ctx.viewer, { storyboardId: input.storyboardId, title: input.title || null, frames: list });
    if (!result.ok) return storyboardFailure(result.code);
    return ok('saved', { to: storyboardAdminHref(input.storyboardId) });
  },
};

const share: AdminOperation<{ storyboardId: string }> = {
  parse: (form) => ({ ok: true, value: ref(form) }),
  async run(ctx, input) {
    const result = await staffShareStoryboard(deps(ctx), ctx.viewer, input);
    if (!result.ok) return storyboardFailure(result.code);
    return ok('published', { to: storyboardAdminHref(input.storyboardId) });
  },
};

const version: AdminOperation<{ storyboardId: string }> = {
  parse: (form) => ({ ok: true, value: ref(form) }),
  async run(ctx, input) {
    const result = await staffNewVersion(deps(ctx), ctx.viewer, input);
    if (!result.ok) return storyboardFailure(result.code);
    return ok('created', { to: storyboardAdminHref(result.board.id) });
  },
};

const remove: AdminOperation<{ storyboardId: string }> = {
  parse: (form) => ({ ok: true, value: ref(form) }),
  async run(ctx, input) {
    const result = await staffDeleteStoryboard(deps(ctx), ctx.viewer, input);
    if (!result.ok) return storyboardFailure(result.code);
    return ok('deleted', { to: STORYBOARD_ADMIN_PATH });
  },
};

export const BRAND_ROOMS_STORYBOARD_OPERATIONS = {
  'brand_rooms.storyboard.create': create,
  'brand_rooms.storyboard.update': update,
  'brand_rooms.storyboard.frames': frames,
  'brand_rooms.storyboard.share': share,
  'brand_rooms.storyboard.version': version,
  'brand_rooms.storyboard.delete': remove,
};
