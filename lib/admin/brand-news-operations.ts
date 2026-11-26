import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  BRAND_NEWS_LIMITS,
  BRAND_NEWS_SHAPES,
  BRAND_NEWS_SLOTS,
  charCount,
  homeSlotModesValid,
  isUuid,
  judgeBrandNewsLink,
  parseBrandNewsAudience,
  periodValid,
  publishRefusals,
  type BrandNewsAudience,
  type BrandNewsShape,
  type BrandNewsSlot,
  type BrandNewsStatus,
} from '@/lib/brand-news/contracts';
import { brandNewsReady, brandNewsSlotsReady, resetBrandNewsSlotsProbe } from '@/lib/brand-news/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandNewsOpen } from '@/lib/flags';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import { sha256Hex } from './assets';
import * as f from './form';

/**
 * The home's news slot, admin side (docs/BRAND-PROJECT-SPINE.md §6, slice 3b + N2): `brandNews.save` (create or edit a
 * draft), `brandNews.publish` (draft → live, ending whatever was live in the slot), `brandNews.end` (live → ended), and
 * `brandNews.delete` (delete a draft permanently). Admin-only through the one door like every operation (dispatcher +
 * registry); each change writes a `platform_audit` row in the same transaction.
 *
 * Refusals reuse the admin dictionary's codes; the detail says exactly what (`brandNews:<what>`):
 *   disabled        `BRAND_NEWS` is off (whatever the form holds), or migrations 0196/0204 have not reached this database
 *   invalid         a field the rules refuse (`brandNews:<field>[:<reason>]`)
 *   upload/storage  the banner picture (`brandNews:image:<reason>`)
 *   notFound        no such announcement
 *   notDraft        a live or ended announcement cannot be edited, published again, or deleted
 *   notPublishable  `brandNews:<reason>,<reason>` (contracts.ts `publishRefusals`)
 *   staleReview     publish fingerprint mismatch (`brandNews:stale`: saved since this screen opened it)
 *   badTransition   ending a draft (`brandNews:notLive`), or a publish that lost a race for the slot
 *                   (`brandNews:slotBusy`: the other one went live; nothing changed here)
 */

type Env = Record<string, string | undefined>;

const AUDIT_ACTIONS = {
  save: 'brandNews.save',
  publish: 'brandNews.publish',
  end: 'brandNews.end',
  delete: 'brandNews.delete',
} as const;
const LIVE_INDEX = 'brand_announcements_one_live';
const SLOT_CHECK = 'brand_announcements_slot';
const ACCEPTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const WEBP_QUALITY = 82;
/** One line each: no control character (new lines included), no line or paragraph separator, no invisible or direction mark. */
const BAD_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
const AUDIENCE_FIELDS = new Set(['audience', 'audienceModes', 'audiencePlans', 'audienceOrgs']);

const refuse = (what: string) => ({ ok: false as const, detail: `brandNews:${what}` });

async function closed(sql: SqlRunner, env: Env): Promise<AdminOutcome | null> {
  if (!brandNewsOpen(env)) return fail('disabled', 'BRAND_NEWS');
  if (!(await brandNewsReady(sql, env))) return fail('disabled', 'brandNews:migration 0196/0197 not applied');
  return null;
}

async function audit(sql: SqlRunner, ctx: AdminContext, entityId: string, action: string, reason: string, details: Record<string, unknown>): Promise<void> {
  await sql.query('insert into platform_audit (actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5::jsonb)', [
    ctx.viewer.userId ?? null,
    entityId,
    action,
    reason,
    JSON.stringify(details),
  ]);
}

/* ------------------------------------------------------------------ parse */

/**
 * `YYYY-MM-DDTHH:mm[:ss]` (an `<input type="datetime-local">`, read as Korean time), or a full ISO instant with `Z`
 * or an offset. Calendar-checked: 2026-02-30 is refused, not rolled over.
 */
export function parseBrandNewsInstant(raw: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
  if (!match) return null;
  const zone = match[3] ?? '+09:00';
  const date = new Date(`${match[1]}${match[2] ?? ':00'}${zone}`);
  if (!Number.isFinite(date.getTime())) return null;
  const offset = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  if (Math.abs(offset) > 14 * 60) return null;
  return new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 16) === match[1] ? date : null;
}

/** Publish fingerprint (`expectedUpdatedAt`): an explicit-zone ISO instant matching the stored `updated_at`. */
export function parseExpectedUpdatedAt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return null;
  return parseBrandNewsInstant(trimmed)?.toISOString() ?? null;
}

function words(form: FormData, name: string, max: number): { ok: true; value: string } | { ok: false; detail: string } {
  const value = f.str(form, name);
  if (BAD_TEXT.test(value)) return refuse(`${name}:characters`);
  if (charCount(value) > max) return refuse(`${name}:tooLong`);
  return { ok: true, value };
}

/**
 * The audience from the form: either one `audience` field holding the JSON object, or the plain form's fields
 * (`audienceModes` and `audiencePlans` repeated, `audienceOrgs` as ids separated by commas, spaces or new lines).
 * Nothing at all is the default audience; an empty field counts as not sent. Any other `audience…` field, or both
 * ways at once with values, is refused, and so is every key the schema does not know.
 */
function audienceFrom(form: FormData): { ok: true; value: BrandNewsAudience } | { ok: false; detail: string } {
  for (const key of new Set(form.keys())) if (key.startsWith('audience') && !AUDIENCE_FIELDS.has(key)) return refuse('audience:unknownKey');
  const strings = (name: string) =>
    form
      .getAll(name)
      .filter((v): v is string => typeof v === 'string')
      .flatMap((v) => (name === 'audienceOrgs' ? v.split(/[\s,]+/) : [v.trim()]))
      .filter((v) => v !== '');
  const modes = strings('audienceModes');
  const plans = strings('audiencePlans');
  const orgs = strings('audienceOrgs');
  const json = f.str(form, 'audience');
  let value: unknown;
  if (json !== '') {
    if (modes.length || plans.length || orgs.length) return refuse('audience:twoWays');
    try {
      value = JSON.parse(json);
    } catch {
      return refuse('audience:json');
    }
  } else {
    const out: Record<string, unknown> = {};
    if (modes.length) out.modes = modes;
    if (plans.length) out.plans = plans;
    if (orgs.length) out.orgs = orgs;
    value = out;
  }
  const audience = parseBrandNewsAudience(value);
  return audience ? { ok: true, value: audience } : refuse('audience');
}

export interface BrandNewsSaveInput {
  id: string | null;
  slot: BrandNewsSlot;
  slotSpecified: boolean;
  kickerKo: string;
  kickerEn: string;
  titleKo: string;
  titleEn: string;
  ctaLabelKo: string;
  ctaLabelEn: string;
  ctaHref: string;
  shape: BrandNewsShape;
  startsAt: Date;
  endsAt: Date;
  audience: BrandNewsAudience;
  image: File | null;
}

function parseSave(form: FormData): { ok: true; value: BrandNewsSaveInput } | { ok: false; detail: string } {
  const rawId = f.str(form, 'id');
  if (rawId !== '' && !isUuid(rawId)) return refuse('id');
  const rawSlot = f.str(form, 'slot');
  const slotSpecified = rawSlot !== '';
  const slotValue = slotSpecified ? rawSlot : 'home';
  if (!(BRAND_NEWS_SLOTS as readonly string[]).includes(slotValue)) return refuse('slot');
  const slot = slotValue as BrandNewsSlot;
  const L = BRAND_NEWS_LIMITS;
  const fields = {
    kickerKo: words(form, 'kickerKo', L.kickerChars),
    kickerEn: words(form, 'kickerEn', L.kickerChars),
    titleKo: words(form, 'titleKo', L.titleChars),
    titleEn: words(form, 'titleEn', L.titleChars),
    ctaLabelKo: words(form, 'ctaLabelKo', L.ctaLabelChars),
    ctaLabelEn: words(form, 'ctaLabelEn', L.ctaLabelChars),
  };
  for (const field of Object.values(fields)) if (!field.ok) return field;
  const text = (key: keyof typeof fields) => (fields[key] as { ok: true; value: string }).value;

  // The link is judged as posted (untrimmed): a space anywhere, leading or trailing included, is refused.
  const rawHref = form.get('ctaHref');
  const ctaHref = typeof rawHref === 'string' ? rawHref : '';
  if (ctaHref !== '') {
    const link = judgeBrandNewsLink(ctaHref);
    if (!link.ok) return refuse(`ctaHref:${link.reason}`);
  }

  const rawShape = f.str(form, 'shape') || 'line';
  if (!(BRAND_NEWS_SHAPES as readonly string[]).includes(rawShape)) return refuse('shape');
  const shape = rawShape as BrandNewsShape;

  const startsAt = parseBrandNewsInstant(f.str(form, 'startsAt'));
  const endsAt = parseBrandNewsInstant(f.str(form, 'endsAt'));
  if (!startsAt) return refuse('startsAt');
  if (!endsAt) return refuse('endsAt');
  if (!periodValid(startsAt, endsAt)) return refuse('period');

  const audience = audienceFrom(form);
  if (!audience.ok) return audience;
  if ((!rawId || slotSpecified) && !homeSlotModesValid(slot, audience.value)) return refuse('audience:modes');

  const image = f.file(form, 'image');
  if (image && shape !== 'banner') return refuse('image:notBanner');

  return {
    ok: true,
    value: {
      id: rawId === '' ? null : rawId.toLowerCase(),
      slot,
      slotSpecified,
      kickerKo: text('kickerKo'),
      kickerEn: text('kickerEn'),
      titleKo: text('titleKo'),
      titleEn: text('titleEn'),
      ctaLabelKo: text('ctaLabelKo'),
      ctaLabelEn: text('ctaLabelEn'),
      ctaHref,
      shape,
      startsAt,
      endsAt,
      audience: audience.value,
      image,
    },
  };
}

/* ------------------------------------------------------------------ image */

/**
 * The banner picture, by landing media's path (lib/admin/landing-media-operations.ts): re-encoded whatever arrives
 * (oriented, WebP, metadata stripped), content-addressed in the public bucket. The design's rules are checked on the
 * bytes: the picture must be exactly 1600×400 (it is never scaled, so nothing the founder approved is cropped or
 * stretched), and the stored WebP must be at most 400 KB.
 */
async function storeBannerImage(ctx: AdminContext, file: File): Promise<{ ok: true; key: string; width: number; height: number } | { ok: false; outcome: AdminOutcome }> {
  const I = BRAND_NEWS_LIMITS.image;
  if (file.size > BRAND_NEWS_LIMITS.imageUploadMaxBytes) return { ok: false, outcome: fail('upload', 'brandNews:image:tooLarge') };
  if (file.type && !ACCEPTED_IMAGES.has(file.type)) return { ok: false, outcome: fail('upload', 'brandNews:image:type') };
  let data: Buffer;
  let width: number;
  let height: number;
  try {
    const encoded = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 64_000_000 })
      .rotate()
      .webp({ quality: WEBP_QUALITY, effort: 5, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true });
    data = encoded.data;
    width = encoded.info.width;
    height = encoded.info.height;
  } catch {
    return { ok: false, outcome: fail('upload', 'brandNews:image:unreadable') };
  }
  if (width !== I.width || height !== I.height) return { ok: false, outcome: fail('upload', `brandNews:image:size ${width}x${height}`) };
  if (data.byteLength > I.maxBytes) return { ok: false, outcome: fail('upload', `brandNews:image:bytes ${data.byteLength}`) };
  const bytes = new Uint8Array(data);
  const key = `${sha256Hex(bytes)}.webp`;
  try {
    const staged = `content/brand-news/${randomUUID()}.webp`;
    await ctx.storage.putStaging(staged, bytes, I.mime);
    await ctx.storage.copy({ fromKey: staged, toBucket: 'public-content', toKey: key });
  } catch (error) {
    console.error('[brand-news] image store failed', error instanceof Error ? error.message : error);
    return { ok: false, outcome: fail('storage', 'brandNews:image:store') };
  }
  return { ok: true, key, width, height };
}

/* ------------------------------------------------------------- operations */

interface StoredRow {
  id: string;
  slot: string;
  status: BrandNewsStatus;
  shape: BrandNewsShape;
  title_ko: string;
  title_en: string;
  cta_href: string;
  image_key: string | null;
  image_w: number | null;
  image_h: number | null;
  starts_at: Date | string;
  ends_at: Date | string;
  audience: unknown;
  updated_at: Date | string;
  db_now: Date | string;
}

const ROW_FOR_UPDATE =
  'select id::text as id, slot, status, shape, title_ko, title_en, cta_href, image_key, image_w, image_h, starts_at, ends_at, audience, updated_at, now() as db_now from brand_announcements where id = $1 for update';

const isSlotConstraintError = (error: unknown): boolean => {
  const e = error as { code?: string; constraint?: string; message?: string } | null;
  return e?.code === '23514' && (e.constraint === SLOT_CHECK || String(e.message ?? '').includes(SLOT_CHECK));
};

export function brandNewsSave(env: Env = process.env): AdminOperation<BrandNewsSaveInput> {
  return {
    parse: parseSave,
    async run(ctx, input) {
      const shut = await closed(ctx.sql, env);
      if (shut) return shut;
      if (input.slot === 'team_home' && !(await brandNewsSlotsReady(ctx.sql))) {
        return fail('disabled', 'brandNews:migration 0204/0205 not applied');
      }
      // An edit of something that is not a draft is refused before a picture is stored for it.
      if (input.id) {
        const current = (await ctx.sql.query<{ status: string; slot: string }>('select status, slot from brand_announcements where id = $1', [input.id])).rows[0];
        if (!current) return fail('notFound', 'brandNews:id');
        if (current.status !== 'draft') return fail('notDraft', `brandNews:${current.status}`);
        if (input.slotSpecified && input.slot !== current.slot) return fail('invalid', 'brandNews:slot:immutable');
        const currentSlot: BrandNewsSlot = current.slot === 'team_home' ? 'team_home' : 'home';
        if (!homeSlotModesValid(currentSlot, input.audience)) return fail('invalid', 'brandNews:audience:modes');
      }
      let image: { key: string; width: number; height: number } | null = null;
      if (input.image) {
        const stored = await storeBannerImage(ctx, input.image);
        if (!stored.ok) return stored.outcome;
        image = stored;
      }
      const values = [
        input.kickerKo,
        input.kickerEn,
        input.titleKo,
        input.titleEn,
        input.ctaLabelKo,
        input.ctaLabelEn,
        input.ctaHref,
        input.shape,
        input.startsAt.toISOString(),
        input.endsAt.toISOString(),
        JSON.stringify(input.audience),
      ];
      try {
        return await ctx.sql.transaction(async (tx) => {
          if (!input.id) {
            const id = randomUUID();
            await tx.query(
              `insert into brand_announcements (id, slot, kicker_ko, kicker_en, title_ko, title_en, cta_label_ko, cta_label_en, cta_href, shape, starts_at, ends_at, audience,
                 image_key, image_w, image_h, created_by)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, (select id from profiles where id = $17::uuid))`,
              [id, input.slot, ...values, image?.key ?? null, image?.width ?? null, image?.height ?? null, ctx.viewer.userId ?? null],
            );
            await audit(tx, ctx, id, AUDIT_ACTIONS.save, 'brand_news_draft_created', { slot: input.slot, created: true, shape: input.shape, image: image?.key ?? null });
            return ok('created', { detail: id });
          }
          const row = (await tx.query<StoredRow>(ROW_FOR_UPDATE, [input.id])).rows[0];
          if (!row) return fail('notFound', 'brandNews:id');
          if (row.status !== 'draft') return fail('notDraft', `brandNews:${row.status}`);
          if (input.slotSpecified && input.slot !== row.slot) return fail('invalid', 'brandNews:slot:immutable');
          const rowSlot: BrandNewsSlot = row.slot === 'team_home' ? 'team_home' : 'home';
          if (!homeSlotModesValid(rowSlot, input.audience)) return fail('invalid', 'brandNews:audience:modes');
          // A line keeps no picture; a banner keeps its picture unless a new one was posted.
          const kept = input.shape === 'banner' ? (image ?? (row.image_key ? { key: row.image_key, width: Number(row.image_w), height: Number(row.image_h) } : null)) : null;
          await tx.query(
            `update brand_announcements
                set kicker_ko = $2, kicker_en = $3, title_ko = $4, title_en = $5, cta_label_ko = $6, cta_label_en = $7, cta_href = $8, shape = $9,
                    starts_at = $10, ends_at = $11, audience = $12::jsonb, image_key = $13, image_w = $14, image_h = $15,
                    updated_at = greatest(now(), updated_at + interval '1 millisecond')
              where id = $1 and status = 'draft'`,
            [input.id, ...values, kept?.key ?? null, kept?.width ?? null, kept?.height ?? null],
          );
          await audit(tx, ctx, input.id, AUDIT_ACTIONS.save, 'brand_news_draft_saved', { slot: row.slot, created: false, shape: input.shape, image: kept?.key ?? null });
          return ok('saved', { detail: input.id });
        });
      } catch (error) {
        if (isSlotConstraintError(error)) {
          resetBrandNewsSlotsProbe();
          return fail('disabled', 'brandNews:migration 0204/0205 not applied');
        }
        throw error;
      }
    },
  };
}

const isLiveSlotRace = (error: unknown): boolean => {
  const e = error as { code?: string; constraint?: string; message?: string } | null;
  return e?.code === '23505' && (e.constraint === LIVE_INDEX || String(e.message ?? '').includes(LIVE_INDEX));
};

export function brandNewsPublish(env: Env = process.env): AdminOperation<{ id: string; expectedUpdatedAt: string | null }> {
  return {
    parse(form) {
      const id = f.str(form, 'id');
      if (!isUuid(id)) return refuse('id');
      const rawUpdatedAt = f.str(form, 'expectedUpdatedAt');
      if (rawUpdatedAt === '') return { ok: true, value: { id: id.toLowerCase(), expectedUpdatedAt: null } };
      const expectedUpdatedAt = parseExpectedUpdatedAt(rawUpdatedAt);
      if (!expectedUpdatedAt) return refuse('expectedUpdatedAt');
      return { ok: true, value: { id: id.toLowerCase(), expectedUpdatedAt } };
    },
    async run(ctx, input) {
      const shut = await closed(ctx.sql, env);
      if (shut) return shut;
      const slotsReady = await brandNewsSlotsReady(ctx.sql);
      if (slotsReady && input.expectedUpdatedAt === null) return fail('invalid', 'brandNews:expectedUpdatedAt');
      try {
        return await ctx.sql.transaction(async (tx) => {
          const row = (await tx.query<StoredRow>(ROW_FOR_UPDATE, [input.id])).rows[0];
          if (!row) return fail('notFound', 'brandNews:id');
          if (row.status !== 'draft') return fail('notDraft', `brandNews:${row.status}`);
          if (input.expectedUpdatedAt !== null && input.expectedUpdatedAt !== new Date(row.updated_at).toISOString()) {
            return fail('staleReview', 'brandNews:stale');
          }
          const slot: BrandNewsSlot = row.slot === 'team_home' ? 'team_home' : 'home';
          const parsedAudience = parseBrandNewsAudience(row.audience);
          if (parsedAudience && !homeSlotModesValid(slot, parsedAudience)) {
            return fail('invalid', 'brandNews:audience:modes');
          }
          const reasons = publishRefusals(
            {
              slot,
              status: row.status,
              titleKo: row.title_ko,
              titleEn: row.title_en,
              ctaHref: row.cta_href,
              shape: row.shape,
              imageKey: row.image_key,
              startsAt: new Date(row.starts_at),
              endsAt: new Date(row.ends_at),
              audience: row.audience,
            },
            new Date(row.db_now),
          );
          if (reasons.length) return fail('notPublishable', `brandNews:${reasons.join(',')}`);
          // The slot's live announcement ends in the same transaction; the unique index refuses a second live row.
          const ended = (
            await tx.query<{ id: string }>(
              `update brand_announcements
                  set status = 'ended', ended_at = now(), updated_at = greatest(now(), updated_at + interval '1 millisecond')
                where slot = $1 and status = 'live' and id <> $2 returning id::text as id`,
              [row.slot, input.id],
            )
          ).rows.map((r) => String(r.id));
          await tx.query(
            `update brand_announcements
                set status = 'live', published_at = now(), updated_at = greatest(now(), updated_at + interval '1 millisecond')
              where id = $1 and status = 'draft'`,
            [input.id],
          );
          for (const id of ended) await audit(tx, ctx, id, AUDIT_ACTIONS.end, 'brand_news_ended_by_publish', { slot: row.slot, by: input.id });
          await audit(tx, ctx, input.id, AUDIT_ACTIONS.publish, 'brand_news_published', { slot: row.slot, ended });
          return ok('published', { detail: input.id });
        });
      } catch (error) {
        if (isLiveSlotRace(error)) return fail('badTransition', 'brandNews:slotBusy');
        if (isSlotConstraintError(error)) {
          resetBrandNewsSlotsProbe();
          return fail('disabled', 'brandNews:migration 0204/0205 not applied');
        }
        throw error;
      }
    },
  };
}

export function brandNewsEnd(env: Env = process.env): AdminOperation<{ id: string }> {
  return {
    parse(form) {
      const id = f.str(form, 'id');
      return isUuid(id) ? { ok: true, value: { id: id.toLowerCase() } } : refuse('id');
    },
    async run(ctx, input) {
      const shut = await closed(ctx.sql, env);
      if (shut) return shut;
      return ctx.sql.transaction(async (tx) => {
        const row = (await tx.query<StoredRow>(ROW_FOR_UPDATE, [input.id])).rows[0];
        if (!row) return fail('notFound', 'brandNews:id');
        if (row.status === 'ended') return ok('unpublished', { detail: input.id });
        if (row.status !== 'live') return fail('badTransition', 'brandNews:notLive');
        await tx.query(
          `update brand_announcements
              set status = 'ended', ended_at = now(), updated_at = greatest(now(), updated_at + interval '1 millisecond')
            where id = $1 and status = 'live'`,
          [input.id],
        );
        await audit(tx, ctx, input.id, AUDIT_ACTIONS.end, 'brand_news_ended', { slot: row.slot });
        return ok('unpublished', { detail: input.id });
      });
    },
  };
}

export function brandNewsDelete(env: Env = process.env): AdminOperation<{ id: string }> {
  return {
    parse(form) {
      const id = f.str(form, 'id');
      return isUuid(id) ? { ok: true, value: { id: id.toLowerCase() } } : refuse('id');
    },
    async run(ctx, input) {
      const shut = await closed(ctx.sql, env);
      if (shut) return shut;
      if (!(await brandNewsSlotsReady(ctx.sql))) return fail('disabled', 'brandNews:migration 0204/0205 not applied');
      try {
        return await ctx.sql.transaction(async (tx) => {
          const row = (await tx.query<StoredRow>(ROW_FOR_UPDATE, [input.id])).rows[0];
          if (!row) return fail('notFound', 'brandNews:id');
          if (row.status !== 'draft') return fail('notDraft', `brandNews:${row.status}`);
          await tx.query("delete from brand_announcements where id = $1 and status = 'draft'", [input.id]);
          await audit(tx, ctx, input.id, AUDIT_ACTIONS.delete, 'brand_news_draft_deleted', {
            slot: row.slot,
            shape: row.shape,
            image: row.image_key ?? null,
          });
          return ok('deleted', { detail: input.id, to: '/admin/brand-news' });
        });
      } catch (error) {
        if ((error as { code?: string } | null)?.code === '42501') {
          resetBrandNewsSlotsProbe();
          return fail('disabled', 'brandNews:migration 0204/0205 not applied');
        }
        throw error;
      }
    },
  };
}

/**
 * The dispatcher parses a form before it runs the operation (lib/admin/dispatch.ts). While `BRAND_NEWS` is off,
 * `parse` lets any form through and `run` answers `disabled`, so a switched-off slot answers one code whatever the
 * form holds. Each operation's own `run` checks the switch and the tables again.
 */
function switched<T>(op: AdminOperation<T>, env: Env = process.env): AdminOperation<T | null> {
  return {
    parse: (form) => (brandNewsOpen(env) ? op.parse(form) : { ok: true, value: null }),
    run: (ctx, input) => (input === null ? Promise.resolve(fail('disabled', 'BRAND_NEWS')) : op.run(ctx, input)),
  };
}

export const BRAND_NEWS_OPERATIONS = {
  'brandNews.save': switched(brandNewsSave()),
  'brandNews.publish': switched(brandNewsPublish()),
  'brandNews.end': switched(brandNewsEnd()),
  'brandNews.delete': switched(brandNewsDelete()),
} as const;
