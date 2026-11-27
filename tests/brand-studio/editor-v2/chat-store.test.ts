import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REAL_CHAT_FILM_ID,
  EDITOR_CHAT_MAX_BYTES,
  EDITOR_CHAT_MAX_DRAFT_CHARS,
  EDITOR_CHAT_MAX_ENTRIES,
  EDITOR_CHAT_STORAGE_PREFIX,
  EDITOR_CHAT_TTL_MS,
  SAMPLE_CHAT_FILM_ID,
  clearEditorChat,
  editorChatStorageKey,
  loadEditorChat,
  parseStoredEditorChat,
  resolveChatFilmId,
  saveEditorChat,
  serializeEditorChat,
  type StoredChatEntry,
} from '@/components/brand-studio/editor-v2/chat-store';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';

function stubStorage() {
  const map = new Map<string, string>();
  const getItem = vi.fn((key: string) => map.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    map.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    map.delete(key);
  });
  vi.stubGlobal('window', { localStorage: { getItem, setItem, removeItem } });
  return { map, getItem, setItem, removeItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor-v2 chat-store', () => {
  it('resolves stable film ids for real mode and constant sample for sample mode, isolating two films and two members on one browser', () => {
    expect(resolveChatFilmId({ isReal: false, filmId: 'ignored', projectId: 'ignored' })).toBe(SAMPLE_CHAT_FILM_ID);
    expect(resolveChatFilmId({ isReal: true, filmId: 'film-1', projectId: 'proj-1' })).toBe('film-1');
    expect(resolveChatFilmId({ isReal: true, projectId: 'proj-1' })).toBe('proj-1');
    expect(resolveChatFilmId({ isReal: true })).toBe(DEFAULT_REAL_CHAT_FILM_ID);

    const store = stubStorage();
    const scope1 = { organizationId: ORG_A, userId: USER_1, filmId: 'film-a' };
    const scope2 = { organizationId: ORG_A, userId: USER_2, filmId: 'film-a' };
    const scopeOtherOrg = { organizationId: ORG_B, userId: USER_1, filmId: 'film-a' };
    const scopeFilmB = { organizationId: ORG_A, userId: USER_1, filmId: 'film-b' };

    expect(editorChatStorageKey(scope1)).toBe(`${EDITOR_CHAT_STORAGE_PREFIX}:${ORG_A}:${USER_1}:film-a`);
    expect(editorChatStorageKey(scope2)).toBe(`${EDITOR_CHAT_STORAGE_PREFIX}:${ORG_A}:${USER_2}:film-a`);
    expect(editorChatStorageKey(scopeFilmB)).toBe(`${EDITOR_CHAT_STORAGE_PREFIX}:${ORG_A}:${USER_1}:film-b`);

    const now = 1_800_000_000_000;
    saveEditorChat(scope1, { entries: [{ id: 'u1', kind: 'user', text: '필름A 요청' }], draft: '초안A' }, now);
    saveEditorChat(scope2, { entries: [{ id: 'u2', kind: 'user', text: '멤버2 요청' }], draft: '초안2' }, now);
    saveEditorChat(scopeFilmB, { entries: [{ id: 'u3', kind: 'user', text: '필름B 요청' }], draft: '초안B' }, now);

    expect(loadEditorChat(scope1, now)).toEqual({
      entries: [{ id: 'u1', kind: 'user', text: '필름A 요청' }],
      draft: '초안A',
    });
    expect(loadEditorChat(scope2, now)).toEqual({
      entries: [{ id: 'u2', kind: 'user', text: '멤버2 요청' }],
      draft: '초안2',
    });
    expect(loadEditorChat(scopeFilmB, now)).toEqual({
      entries: [{ id: 'u3', kind: 'user', text: '필름B 요청' }],
      draft: '초안B',
    });
    expect(loadEditorChat(scopeOtherOrg, now)).toEqual({ entries: [], draft: '' });

    clearEditorChat(scope1);
    expect(store.map.has(editorChatStorageKey(scope1))).toBe(false);
    expect(loadEditorChat(scopeFilmB, now).entries).toHaveLength(1);
    expect(loadEditorChat(scope2, now).entries).toHaveLength(1);
  });

  it('downgrades open proposal and ask entries on load and strips in-memory history fields before storage', () => {
    const store = stubStorage();
    const scope = { organizationId: ORG_A, userId: USER_1, filmId: 'film-a' };
    const now = 1_800_000_000_000;

    saveEditorChat(
      scope,
      {
        entries: [
          {
            id: 'u1',
            kind: 'user',
            text: '세로 영상으로 바꿔 줘',
            chips: [{ kind: 'cut', label: '컷 1' }],
          },
          {
            id: 'p1',
            kind: 'proposal',
            lines: ['화면을 세로 비율로 바꿉니다'],
            status: 'open',
            baseSequence: { fps: 30 },
            nextSequence: { fps: 30 },
            historyMark: 99,
          },
          {
            id: 'a1',
            kind: 'applied',
            lines: ['2번 컷이 2초가 됩니다'],
            undone: false,
            historySequence: { fps: 30 },
            historyMark: 100,
          },
          {
            id: 'q1',
            kind: 'ask',
            about: 'cut',
            message: '어느 컷을 줄일까요?',
            choices: [{ value: 'c1', label: '컷 1' }],
            status: 'open',
          },
          { id: 'n1', kind: 'note', text: '바꿀 내용이 없어요.' },
        ],
        draft: '이어서 쓸 문장',
      },
      now,
    );

    const rawSaved = store.map.get(editorChatStorageKey(scope))!;
    expect(rawSaved).not.toContain('historyMark');
    expect(rawSaved).not.toContain('historySequence');
    expect(rawSaved).not.toContain('baseSequence');
    expect(rawSaved).not.toContain('nextSequence');

    const loaded = loadEditorChat(scope, now);
    expect(loaded.draft).toBe('이어서 쓸 문장');
    expect(loaded.entries).toEqual<StoredChatEntry[]>([
      { id: 'u1', kind: 'user', text: '세로 영상으로 바꿔 줘', chips: [{ kind: 'cut', label: '컷 1' }] },
      { id: 'p1', kind: 'proposal', lines: ['화면을 세로 비율로 바꿉니다'], status: 'dismissed' },
      { id: 'a1', kind: 'applied', lines: ['2번 컷이 2초가 됩니다'], undone: false },
      {
        id: 'q1',
        kind: 'ask',
        about: 'cut',
        message: '어느 컷을 줄일까요?',
        choices: [{ value: 'c1', label: '컷 1' }],
        status: 'closed',
      },
      { id: 'n1', kind: 'note', text: '바꿀 내용이 없어요.' },
    ]);
  });

  it('enforces the 60-entry cap, 64 KiB UTF-8 byte cap, and 500-char draft cap', () => {
    const many: StoredChatEntry[] = Array.from({ length: 85 }, (_, i) => ({
      id: `n-${i}`,
      kind: 'note',
      text: `메모 ${i}`,
    }));
    const serialized = serializeEditorChat(many, '가'.repeat(700), 1000)!;
    const parsed = parseStoredEditorChat(JSON.parse(serialized), 1000);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.entries).toHaveLength(EDITOR_CHAT_MAX_ENTRIES);
      expect(parsed.data.entries[0]!.id).toBe('n-25');
      expect(parsed.data.entries[EDITOR_CHAT_MAX_ENTRIES - 1]!.id).toBe('n-84');
      expect(parsed.data.draft.length).toBe(EDITOR_CHAT_MAX_DRAFT_CHARS);
    }

    const heavy: StoredChatEntry[] = Array.from({ length: 60 }, (_, i) => ({
      id: `heavy-${i}`,
      kind: 'user',
      text: `요청 ${i} ${'한글'.repeat(240)}`,
    }));
    const capped = serializeEditorChat(heavy, '', 1000)!;
    const bytes = new TextEncoder().encode(capped).length;
    expect(bytes).toBeLessThanOrEqual(EDITOR_CHAT_MAX_BYTES);
    const cappedParsed = parseStoredEditorChat(JSON.parse(capped), 1000);
    expect(cappedParsed.ok).toBe(true);
    if (cappedParsed.ok) {
      expect(cappedParsed.data.entries.length).toBeLessThan(60);
      expect(cappedParsed.data.entries.at(-1)!.id).toBe('heavy-59');
    }
  });

  it('expires records after 14 days and cleans up corrupt JSON or wrong versions', () => {
    const store = stubStorage();
    const scope = { organizationId: ORG_A, userId: USER_1, filmId: 'film-a' };
    const key = editorChatStorageKey(scope);
    const t0 = 1_800_000_000_000;

    saveEditorChat(scope, { entries: [{ id: 'u1', kind: 'user', text: '안녕' }], draft: '' }, t0);
    expect(loadEditorChat(scope, t0 + EDITOR_CHAT_TTL_MS - 1).entries).toHaveLength(1);
    expect(loadEditorChat(scope, t0 + EDITOR_CHAT_TTL_MS + 1)).toEqual({ entries: [], draft: '' });
    expect(store.map.has(key)).toBe(false);

    store.map.set(key, '{not-json');
    expect(loadEditorChat(scope, t0)).toEqual({ entries: [], draft: '' });
    expect(store.map.has(key)).toBe(false);

    store.map.set(key, JSON.stringify({ v: 99, updatedAt: t0, entries: [{ id: 'u1', kind: 'user', text: 'x' }] }));
    expect(loadEditorChat(scope, t0)).toEqual({ entries: [], draft: '' });
    expect(store.map.has(key)).toBe(false);

    saveEditorChat(scope, { entries: [{ id: 'u1', kind: 'user', text: 'x' }], draft: '' }, t0);
    expect(store.map.has(key)).toBe(true);
    saveEditorChat(scope, { entries: [], draft: '' }, t0);
    expect(store.map.has(key)).toBe(false);
  });

  it('degrades silently without throwing when storage is blocked or full', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    const scope = { organizationId: ORG_A, userId: USER_1, filmId: 'film-a' };
    expect(loadEditorChat(scope)).toEqual({ entries: [], draft: '' });
    expect(() => saveEditorChat(scope, { entries: [{ id: 'u1', kind: 'user', text: 'test' }], draft: 'abc' })).not.toThrow();
    expect(() => clearEditorChat(scope)).not.toThrow();
  });
});
