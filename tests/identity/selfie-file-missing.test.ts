import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import { RenderObjectNotFound, type RenderStore } from '@/lib/renders/store';
import { readSavedSelfie, saveSelfie, savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { studioReviewFaces, STUDIO_REVIEW_FACES } from '@/lib/recipes/review';

/**
 * A saved photo whose file is gone from the private render store (two were lost in the 2026-11-12
 * move from Supabase storage to R2): the row is live, `store.read` throws `RenderObjectNotFound`.
 * The person is asked for a photo again (`selfie_file_missing`) before anything is created; any
 * other storage failure (credentials, bucket) still throws, so it is never mistaken for a lost file.
 */
describe('a saved photo whose file is missing', () => {
  let h: BillingHarness;
  let objects: Map<string, Uint8Array>;
  let failure: Error | null;
  const picture = async (color: string) => new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: color } }).png().toBuffer());
  const store = (): RenderStore => ({
    name: 'local',
    put: async (key, bytes) => { objects.set(key, bytes); },
    read: async (key) => {
      if (failure) throw failure;
      const bytes = objects.get(key);
      if (!bytes) throw new RenderObjectNotFound(key);
      return bytes;
    },
    url: async () => null,
  });
  const save = async (color: string, userId = USER.buyer, limit = 1) => {
    const saved = await saveSelfie({ sql: h.sql, store: store(), limit }, userId, { bytes: await picture(color), mime: 'image/png', consent: true });
    if (!saved.ok) throw Error(saved.code);
    return saved.id;
  };
  const inputKey = async (id: string) => (await h.sql.query<{ input_key: string }>('select input_key from identity_selfies where id=$1', [id])).rows[0]!.input_key;
  const lastUsed = async (id: string) => (await h.sql.query<{ last_used_at: Date | null }>('select last_used_at from identity_selfies where id=$1', [id])).rows[0]!.last_used_at;

  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    objects = new Map();
    failure = null;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await h.close();
  });

  it('answers selfie_file_missing (not a throw), logs the id only, and does not mark the photo used', async () => {
    const id = await save('#d6d6d6');
    objects.delete(await inputKey(id));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readSavedSelfie(h.sql, store(), USER.buyer, id)).toEqual({ ok: false, code: 'selfie_file_missing' });
    // The older helper every other job creator uses: no usable photo, never an unhandled error.
    expect(await savedSelfiePhoto(h.sql, store(), USER.buyer, id)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[identity] selfie_file_missing', { selfieId: id });
    expect(await lastUsed(id)).toBeNull();
  });

  it('keeps the old answers: a readable photo, and selfie_required for a stranger’s or unknown id', async () => {
    const id = await save('#d6d6d6');
    const read = await readSavedSelfie(h.sql, store(), USER.buyer, id);
    expect(read.ok && read.photo.mime).toBe('image/png');
    expect(await lastUsed(id)).toBeInstanceOf(Date);
    expect(await readSavedSelfie(h.sql, store(), USER.other, id)).toEqual({ ok: false, code: 'selfie_required' });
    expect(await readSavedSelfie(h.sql, store(), USER.buyer, '00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, code: 'selfie_required' });
  });

  it('lets any other storage failure through — a bucket or credentials error is not a missing file', async () => {
    const id = await save('#d6d6d6');
    failure = new Error('render download failed: status 403');
    await expect(readSavedSelfie(h.sql, store(), USER.buyer, id)).rejects.toThrow('status 403');
    await expect(savedSelfiePhoto(h.sql, store(), USER.buyer, id)).rejects.toThrow('status 403');
  });

  it('saving the same photo again brings a lost file back, so "choose a photo again" works with the photo the person still has', async () => {
    const id = await save('#d6d6d6');
    const key = await inputKey(id);
    const original = objects.get(key)!;
    objects.delete(key);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The studio's uploader sends the unreadable photo as `replaceId`; the same bytes are still that photo.
    const again = await saveSelfie({ sql: h.sql, store: store(), limit: 1 }, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true, replaceId: id });
    expect(again).toEqual({ ok: true, id, replaced: false, unchanged: true });
    expect(objects.get(key)).toEqual(original);
    expect(warn).toHaveBeenCalledWith('[identity] selfie_file_restored', { selfieId: id });
    expect((await readSavedSelfie(h.sql, store(), USER.buyer, id)).ok).toBe(true);
  });

  it('a repeat save leaves a file that is there alone, and still lets a storage failure through', async () => {
    const id = await save('#d6d6d6');
    const writes: string[] = [];
    const watched: RenderStore = { ...store(), put: async (key, bytes) => { writes.push(key); objects.set(key, bytes); } };
    expect(await saveSelfie({ sql: h.sql, store: watched, limit: 1 }, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true })).toEqual({ ok: true, id, replaced: false, unchanged: true });
    expect(writes).toEqual([]);
    failure = new Error('render download failed: status 403');
    await expect(saveSelfie({ sql: h.sql, store: watched, limit: 1 }, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true })).rejects.toThrow('status 403');
    expect(writes).toEqual([]);
  });

  it('the studio review skips an admin photo whose file is missing and fills the set with the guide portraits', async () => {
    const lost = await save('#d6d6d6', USER.buyer, 2);
    const kept = await save('#a0a0a0', USER.buyer, 2);
    objects.delete(await inputKey(lost));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const guide = vi.fn(async (_path: string) => new Uint8Array([1, 2, 3]));
    const faces = await studioReviewFaces(h.sql, store(), USER.buyer, guide);
    expect(faces.map(face => face.selfieId ?? 'guide')).toEqual([kept, 'guide', 'guide']);
    expect(guide.mock.calls.map(([path]) => path)).toEqual(STUDIO_REVIEW_FACES.slice(0, 2));
  });
});
