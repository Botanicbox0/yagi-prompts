/**
 * The model "말로 편집" runs on is its own setting (docs/BRAND-EDITING-STUDIO.md §4.5): pinned to one
 * model, moved only by its own env name, never by the studio-wide override.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AssistPlanInputSchema,
  EDIT_ASSIST_DEFAULT_MODEL,
  editAssistGeminiConfig,
  planEditAssist,
} from '@/lib/brand-studio/edit-assist/service';
import { assistFixture } from './fixture';

const KEY = { GEMINI_API_KEY: 'test-key' };

describe('editAssistGeminiConfig', () => {
  it('is null without a key', () => {
    expect(editAssistGeminiConfig({})).toBeNull();
  });

  it('defaults to the pinned model', () => {
    expect(EDIT_ASSIST_DEFAULT_MODEL).toBe('gemini-4-hydrogen');
    expect(editAssistGeminiConfig(KEY)?.model).toBe('gemini-4-hydrogen');
  });

  it('ignores the studio-wide model override', () => {
    expect(editAssistGeminiConfig({ ...KEY, BRAND_STUDIO_ENHANCER_MODEL: 'some-other-model' })?.model).toBe(
      EDIT_ASSIST_DEFAULT_MODEL,
    );
  });

  it('follows its own override and rejects a malformed one', () => {
    expect(editAssistGeminiConfig({ ...KEY, BRAND_STUDIO_EDIT_ASSIST_MODEL: ' next-model-1.0 ' })?.model).toBe('next-model-1.0');
    expect(editAssistGeminiConfig({ ...KEY, BRAND_STUDIO_EDIT_ASSIST_MODEL: 'bad model/../x' })?.model).toBe(
      EDIT_ASSIST_DEFAULT_MODEL,
    );
  });

  it('keeps the studio key and base URL', () => {
    expect(editAssistGeminiConfig({ ...KEY, GEMINI_BASE_URL: 'https://example.test/v1/' })).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: EDIT_ASSIST_DEFAULT_MODEL,
    });
  });
});

describe('planEditAssist', () => {
  it('calls the pinned model even when the studio override names another', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: 'cannot', reason: 'nothing_to_edit' }) }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    await planEditAssist(
      AssistPlanInputSchema.parse({
        organizationId: '00000000-0000-4000-8000-000000000001',
        message: '오프닝을 좀 더 짧게 해줘',
        locale: 'ko',
        project: assistFixture(),
      }),
      { env: { ...KEY, BRAND_STUDIO_ENHANCER_MODEL: 'some-other-model' }, providerMode: 'live', fetchImpl },
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toContain('/models/gemini-4-hydrogen:generateContent');
  });
});
