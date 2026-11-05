import { describe, expect, it, beforeEach } from 'vitest';
import {
  PROMPT_DRAFT_KEY,
  savePromptDraft,
  loadPromptDraft,
  clearPromptDraft,
  hasPromptDraft,
  hasMeaningfulDraft,
  type PromptDraft,
} from '@/lib/admin/prompt-draft';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

describe('lib/admin/prompt-draft', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  const sampleDraft: PromptDraft = {
    version: 1,
    savedAt: '2026-11-05T06:00:00.000Z',
    title: 'Neon Tokyo Run',
    titleKo: '네온 도쿄 러너',
    promptText: 'Cinematic tracking shot of Image 1 running through Shibuya at dusk, neon reflections on wet asphalt.',
    models: ['seedance2.5'],
    useCase: ['cinematic', 'portrait'],
    sourceUrl: 'https://instagram.com/p/example',
    processMd: 'Testing reflections on 35mm lens setup.',
    processMdKo: '비에 젖은 아스팔트 반사광 집중 튜닝.',
    videoRef: '{"key":"stg/video-123.mp4","size":10485760}',
    posterRef: '{"key":"stg/poster-123.jpg","size":524288}',
    videoLabel: 'run.mp4 · 10.0MB',
    posterLabel: 'frame-picked: 2.4s',
  };

  it('saves and loads a valid draft in storage', () => {
    expect(hasPromptDraft(storage)).toBe(false);
    expect(loadPromptDraft(storage)).toBeNull();

    const ok = savePromptDraft(storage, sampleDraft);
    expect(ok).toBe(true);
    expect(hasPromptDraft(storage)).toBe(true);

    const loaded = loadPromptDraft(storage);
    expect(loaded).toEqual(sampleDraft);
  });

  it('clears draft from storage', () => {
    savePromptDraft(storage, sampleDraft);
    expect(hasPromptDraft(storage)).toBe(true);

    clearPromptDraft(storage);
    expect(hasPromptDraft(storage)).toBe(false);
    expect(loadPromptDraft(storage)).toBeNull();
  });

  it('handles null storage gracefully without throwing', () => {
    expect(savePromptDraft(null, sampleDraft)).toBe(false);
    expect(loadPromptDraft(null)).toBeNull();
    expect(hasPromptDraft(null)).toBe(false);
    expect(() => clearPromptDraft(null)).not.toThrow();
  });

  it('detects whether draft has meaningful content to save', () => {
    expect(hasMeaningfulDraft({
      version: 1,
      savedAt: '2026-11-05T00:00:00.000Z',
      title: '   ',
      titleKo: '',
      promptText: '',
      models: [],
      useCase: [],
      sourceUrl: '',
      processMd: '',
      processMdKo: '',
    })).toBe(false);

    expect(hasMeaningfulDraft({
      version: 1,
      savedAt: '2026-11-05T00:00:00.000Z',
      title: 'Draft Title',
      titleKo: '',
      promptText: '',
      models: [],
      useCase: [],
      sourceUrl: '',
      processMd: '',
      processMdKo: '',
    })).toBe(true);

    expect(hasMeaningfulDraft({
      version: 1,
      savedAt: '2026-11-05T00:00:00.000Z',
      title: '',
      titleKo: '',
      promptText: 'Some prompt content',
      models: [],
      useCase: [],
      sourceUrl: '',
      processMd: '',
      processMdKo: '',
    })).toBe(true);

    expect(hasMeaningfulDraft({
      version: 1,
      savedAt: '2026-11-05T00:00:00.000Z',
      title: '',
      titleKo: '',
      promptText: '',
      models: [],
      useCase: [],
      sourceUrl: '',
      processMd: '',
      processMdKo: '',
      videoRef: '{"key":"stg/1"}',
    })).toBe(true);
  });

  it('rejects corrupted or outdated json gracefully', () => {
    storage.setItem(PROMPT_DRAFT_KEY, '{ invalid json');
    expect(loadPromptDraft(storage)).toBeNull();

    storage.setItem(PROMPT_DRAFT_KEY, JSON.stringify({ version: 999, title: 'Old version' }));
    expect(loadPromptDraft(storage)).toBeNull();
  });
});
