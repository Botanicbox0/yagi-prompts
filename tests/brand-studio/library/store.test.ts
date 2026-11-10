import { describe, expect, it, vi } from 'vitest';
import type { StudioFailure } from '@/lib/brand-studio/contracts';
import type { LibraryFolderWire, LibraryItemWire, LibraryOperation } from '@/lib/brand-studio/library-contracts';
import { createLibraryApi, type LibraryApi } from '@/components/brand-studio/rail/library-api';
import { createLibraryStore, cleanFolderName, hasExtras, isTempFolder, libraryOf } from '@/components/brand-studio/rail/library-store';

/** docs/BRAND-STUDIO-V3.md §4 — the hook's writes are optimistic and roll back on refusal. */
const ORG = '11111111-1111-4111-8111-111111111111';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number): LibraryItemWire => ({
  key: `a:${uuid(n)}`,
  ref: { assetId: uuid(n) },
  kind: 'image',
  url: `/m/${n}.png`,
  thumbUrl: null,
  name: `Asset ${n}`,
  width: 10,
  height: 10,
  seconds: null,
  createdAt: '2026-11-11T00:00:00.000Z',
});
const output = (n: number): LibraryItemWire => ({ ...asset(n), key: `o:${uuid(n)}`, ref: { outputId: uuid(n) }, name: null });
const folder = (n: number, name: string, count = 0): LibraryFolderWire => ({ id: uuid(100 + n), name, count, covers: [], updatedAt: '2026-11-11T00:00:00.000Z' });
const refused = (code: StudioFailure['code']): StudioFailure => ({ ok: false, code });

/** A client whose answers the test releases by hand. */
function manualApi(start: { folders?: LibraryFolderWire[]; liked?: LibraryItemWire[] } = {}) {
  const pending: Array<{ operation: LibraryOperation; input: unknown; resolve(value: unknown): void }> = [];
  const api: LibraryApi = {
    summary: vi.fn(async () => ({ ok: true as const, folders: start.folders ?? [], liked: start.liked ?? [] })),
    folder: vi.fn(async (id: string) =>
      id === uuid(199) ? refused('not_found') : { ok: true as const, folder: { ...(start.folders ?? []).find((f) => f.id === id)!, count: 1 }, items: [asset(1)] },
    ),
    call: vi.fn((operation, input) => new Promise((resolve) => pending.push({ operation, input, resolve }))) as LibraryApi['call'],
  };
  return { api, pending, answer: (value: unknown) => pending.shift()!.resolve(value) };
}

describe('library store', () => {
  it('loads folders in name order and the likes as keys', async () => {
    const { api } = manualApi({ folders: [folder(2, 'products'), folder(1, 'Logos'), folder(3, 'f10'), folder(4, 'f9')], liked: [output(5), asset(6)] });
    const store = createLibraryStore(api);
    expect(store.get().ready).toBe(false);
    await store.load();
    const snap = store.get();
    expect(snap.ready).toBe(true);
    expect(snap.folders.map((f) => f.name)).toEqual(['f9', 'f10', 'Logos', 'products']);
    expect([...snap.likedKeys]).toEqual([`o:${uuid(5)}`, `a:${uuid(6)}`]);
    const library = libraryOf(store, snap);
    expect(hasExtras(library)).toBe(true);
    expect(library.folderItems(uuid(101))).toBeNull();
  });

  it('flags a failed first load and keeps what it had on a failed refresh', async () => {
    const api = { ...manualApi().api, summary: vi.fn(async () => refused('failed')) };
    const store = createLibraryStore(api);
    await store.load();
    expect(store.get()).toMatchObject({ ready: false, error: true });
  });

  it('likes at once, shows the server item when it answers, and rolls back a refusal in place', async () => {
    const { api, answer, pending } = manualApi({ liked: [asset(1), asset(2), asset(3)] });
    const store = createLibraryStore(api);
    await store.load();
    const like = store.toggleLike({ outputId: uuid(9) });
    expect(store.get().likedKeys.has(`o:${uuid(9)}`)).toBe(true);
    expect(pending[0]!.input).toEqual({ ref: { outputId: uuid(9) }, liked: true });
    answer({ ok: true, liked: true, item: output(9) });
    expect(await like).toBe(true);
    expect(store.get().likedItems.map((i) => i.key)[0]).toBe(`o:${uuid(9)}`);

    const unlike = store.toggleLike({ assetId: uuid(2) });
    expect(store.get().likedItems.map((i) => i.key)).toEqual([`o:${uuid(9)}`, `a:${uuid(1)}`, `a:${uuid(3)}`]);
    expect(pending[0]!.input).toEqual({ ref: { assetId: uuid(2) }, liked: false });
    answer(refused('forbidden'));
    expect(await unlike).toBe(false);
    expect(store.get().likedItems.map((i) => i.key)).toEqual([`o:${uuid(9)}`, `a:${uuid(1)}`, `a:${uuid(2)}`, `a:${uuid(3)}`]);
    expect(store.get().likedKeys.has(`a:${uuid(2)}`)).toBe(true);
    expect(store.get().lastError).toBe('forbidden');
  });

  it('lets the newest press win when two like writes cross', async () => {
    const { api, pending } = manualApi();
    const store = createLibraryStore(api);
    await store.load();
    const first = store.toggleLike({ assetId: uuid(4) });
    const second = store.toggleLike({ assetId: uuid(4) });
    expect(store.get().likedKeys.has(`a:${uuid(4)}`)).toBe(false);
    // The older "like" answers last and must not bring the item back.
    pending[1]!.resolve({ ok: true, liked: false, item: null });
    pending[0]!.resolve({ ok: true, liked: true, item: asset(4) });
    await Promise.all([first, second]);
    expect(store.get().likedKeys.has(`a:${uuid(4)}`)).toBe(false);
    expect(store.get().likedItems).toEqual([]);
  });

  it('creates folders with a stand-in, swaps in the real one, and drops it on refusal', async () => {
    const { api, answer, pending } = manualApi({ folders: [folder(1, 'B')] });
    const store = createLibraryStore(api);
    await store.load();
    const made = store.createFolder('  A    team ');
    expect(pending[0]!.input).toEqual({ name: 'A team' });
    expect(store.get().folders.map((f) => f.name)).toEqual(['A team', 'B']);
    expect(isTempFolder(store.get().folders[0]!.id)).toBe(true);
    answer({ ok: true, folder: folder(2, 'A team') });
    expect(await made).toMatchObject({ id: uuid(102) });
    expect(store.get().folders.map((f) => f.id)).toEqual([uuid(102), uuid(101)]);

    const taken = store.createFolder('b');
    answer(refused('conflict'));
    expect(await taken).toBeNull();
    expect(store.get().folders).toHaveLength(2);
    expect(store.get().lastError).toBe('conflict');
    expect(await store.createFolder('   ')).toBeNull();
    expect(cleanFolderName('x'.repeat(61))).toBeNull();
  });

  it('renames and deletes optimistically and restores both on refusal', async () => {
    const { api, answer } = manualApi({ folders: [folder(1, 'Alpha'), folder(2, 'Beta')] });
    const store = createLibraryStore(api);
    await store.load();
    const rename = store.renameFolder(uuid(101), 'Zeta');
    expect(store.get().folders.map((f) => f.name)).toEqual(['Beta', 'Zeta']);
    answer(refused('conflict'));
    expect(await rename).toBe(false);
    expect(store.get().folders.map((f) => f.name)).toEqual(['Alpha', 'Beta']);

    const remove = store.deleteFolder(uuid(102));
    expect(store.get().folders.map((f) => f.name)).toEqual(['Alpha']);
    answer(refused('failed'));
    expect(await remove).toBe(false);
    expect(store.get().folders.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
  });

  it('files and unfiles with the count moving at once, the server count winning, and a rollback on refusal', async () => {
    const { api, answer } = manualApi({ folders: [folder(1, 'Logos', 0)] });
    const store = createLibraryStore(api);
    await store.load();
    await store.openFolder(uuid(101));
    expect(store.get().items[uuid(101)]!.map((i) => i.key)).toEqual([`a:${uuid(1)}`]);
    expect(store.get().folders[0]!.count).toBe(1);

    const add = store.addToFolder(uuid(101), { outputId: uuid(7) });
    expect(store.get().folders[0]!.count).toBe(2);
    answer({ ok: true, folder: { ...folder(1, 'Logos', 2), covers: ['/m/7.png'] }, item: output(7) });
    expect(await add).toBe(true);
    expect(store.get().items[uuid(101)]!.map((i) => i.key)).toEqual([`o:${uuid(7)}`, `a:${uuid(1)}`]);
    expect(store.get().folders[0]!.covers).toEqual(['/m/7.png']);

    const full = store.addToFolder(uuid(101), { assetId: uuid(8) });
    answer(refused('asset_limit'));
    expect(await full).toBe(false);
    expect(store.get().folders[0]!.count).toBe(2);
    expect(store.get().lastError).toBe('asset_limit');

    const out = store.removeFromFolder(uuid(101), { assetId: uuid(1) });
    expect(store.get().items[uuid(101)]!.map((i) => i.key)).toEqual([`o:${uuid(7)}`]);
    expect(store.get().folders[0]!.count).toBe(1);
    answer(refused('forbidden'));
    expect(await out).toBe(false);
    expect(store.get().items[uuid(101)]!.map((i) => i.key)).toEqual([`o:${uuid(7)}`, `a:${uuid(1)}`]);
    expect(store.get().folders[0]!.count).toBe(2);
  });

  it('forgets a folder someone else deleted when it is opened, and never writes to a stand-in', async () => {
    const { api } = manualApi({ folders: [folder(1, 'Gone'), folder(99, 'Ghost')] });
    const store = createLibraryStore(api);
    await store.load();
    await store.openFolder(uuid(199));
    expect(store.get().folders.map((f) => f.name)).toEqual(['Gone']);
    expect(await store.addToFolder('tmp-1', { assetId: uuid(1) })).toBe(false);
    expect(api.call).not.toHaveBeenCalled();
  });
});

describe('library client', () => {
  it('sends the organization with every operation and maps statuses to codes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const answers = [
      new Response(JSON.stringify({ ok: true, folders: [], liked: [] }), { status: 200 }),
      new Response(JSON.stringify({ ok: false, code: 'feature_unavailable' }), { status: 404 }),
      new Response('nope', { status: 403 }),
    ];
    const fetch = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return answers.shift()!;
    }) as unknown as typeof globalThis.fetch;
    const api = createLibraryApi({ organizationId: ORG, fetch });
    expect(await api.summary()).toEqual({ ok: true, folders: [], liked: [] });
    expect(calls[0]!.url).toBe(`/api/brand-studio/library?organizationId=${ORG}`);
    expect(await api.folder(uuid(1))).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(calls[1]!.url).toBe(`/api/brand-studio/library?organizationId=${ORG}&folder=${uuid(1)}`);
    expect(await api.call('folder.create', { name: 'A' })).toEqual({ ok: false, code: 'forbidden' });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ operation: 'folder.create', input: { name: 'A', organizationId: ORG } });
    expect(calls[2]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  });
});
