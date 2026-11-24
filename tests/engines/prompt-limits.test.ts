import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_CHARS,
  MAX_ENGINE_PROMPT_CHARS,
  SEEDANCE_25_PROMPT_CHARS,
  formatPromptChars,
  promptCharLimit,
  templatePromptCharLimit,
  verifiedPromptCharLimit,
} from '@/lib/engines/prompt-limits';
import { IMAGE_ENGINE_IDS, VIDEO_ENGINE_IDS } from '@/lib/images/engines';
import { MAX_STEP_PROMPT_CHARS } from '@/lib/recipes/schema';

/** Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip; every other engine keeps today's cap. */
describe('prompt limits per engine', () => {
  it('gives Seedance 2.5 15,000 characters and keeps every other engine at the previous 8,000', () => {
    expect(SEEDANCE_25_PROMPT_CHARS).toBe(15_000);
    expect(DEFAULT_PROMPT_CHARS).toBe(8_000);
    expect(promptCharLimit('seedance-2.5')).toBe(15_000);
    for (const id of [...IMAGE_ENGINE_IDS, ...VIDEO_ENGINE_IDS].filter((id) => id !== 'seedance-2.5')) {
      expect(promptCharLimit(id), id).toBe(8_000);
      expect(verifiedPromptCharLimit(id), id).toBeNull();
    }
    expect(promptCharLimit(null)).toBe(8_000);
    expect(promptCharLimit('not-an-engine')).toBe(8_000);
  });

  it('names the largest limit as the most a step may hold, the same number the recipe schema exports', () => {
    expect(MAX_ENGINE_PROMPT_CHARS).toBe(15_000);
    expect(MAX_STEP_PROMPT_CHARS).toBe(MAX_ENGINE_PROMPT_CHARS);
  });

  it('reads a catalogue template by the model it renders on (a long Seedance 2.0 template renders on 2.5)', () => {
    expect(templatePromptCharLimit({ medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'video', engine: 'seedance-2.0', runtimeSeconds: 10 })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'video', engine: 'seedance-2.0', runtimeSeconds: 20 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'video', engine: null, runtimeSeconds: null })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'image', engine: 'gpt-image-2', runtimeSeconds: null })).toBeNull();
  });

  it('writes the numbers with a thousands comma', () => {
    expect(formatPromptChars(SEEDANCE_25_PROMPT_CHARS)).toBe('15,000');
    expect(formatPromptChars(DEFAULT_PROMPT_CHARS)).toBe('8,000');
  });
});
