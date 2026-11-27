import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_CHARS,
  MAGI2_PROMPT_CHARS,
  MAX_ENGINE_PROMPT_CHARS,
  SEEDANCE_25_PROMPT_CHARS,
  formatPromptChars,
  promptCharLimit,
  promptLengthRefusalDetail,
  readPromptLengthRefusal,
  templatePromptCharLimit,
  verifiedPromptCharLimit,
} from '@/lib/engines/prompt-limits';
import { IMAGE_ENGINE_IDS, VIDEO_ENGINE_IDS } from '@/lib/images/engines';
import { MAX_STEP_PROMPT_CHARS } from '@/lib/recipes/schema';

/** Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip; MAGI-2 also takes 15,000; every other engine keeps today's cap. */
describe('prompt limits per engine', () => {
  it('gives Seedance 2.5 and MAGI-2 15,000 characters and keeps every other engine at the previous 8,000', () => {
    expect(SEEDANCE_25_PROMPT_CHARS).toBe(15_000);
    expect(MAGI2_PROMPT_CHARS).toBe(15_000);
    expect(DEFAULT_PROMPT_CHARS).toBe(8_000);
    expect(promptCharLimit('seedance-2.5')).toBe(15_000);
    expect(promptCharLimit('magi-2')).toBe(15_000);
    expect(verifiedPromptCharLimit('magi-2')).toBe(15_000);
    for (const id of [...IMAGE_ENGINE_IDS, ...VIDEO_ENGINE_IDS].filter((id) => id !== 'seedance-2.5' && id !== 'magi-2')) {
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
    expect(templatePromptCharLimit({ medium: 'video', engine: 'magi-2', runtimeSeconds: 10 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'video', engine: 'seedance-2.0', runtimeSeconds: 10 })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'video', engine: 'seedance-2.0', runtimeSeconds: 20 })).toBe(15_000);
    // Parity with main: empty/unknown video engines follow the default 2.0/2.5 runtime rule.
    expect(templatePromptCharLimit({ medium: 'video', engine: null, runtimeSeconds: null })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'video', engine: null, runtimeSeconds: 20 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'video', engine: '', runtimeSeconds: 10 })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'video', engine: '', runtimeSeconds: 20 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'video', engine: 'not-an-engine', runtimeSeconds: 10 })).toBeNull();
    expect(templatePromptCharLimit({ medium: 'video', engine: 'not-an-engine', runtimeSeconds: 20 })).toBe(15_000);
    expect(templatePromptCharLimit({ medium: 'image', engine: 'gpt-image-2', runtimeSeconds: null })).toBeNull();
  });

  it('formats refusal details with the template engine name rather than hard-coding Seedance 2.5', () => {
    const magiDetail = promptLengthRefusalDetail('promptText', { clip: 1, stepId: null, chars: 15_001, limit: 15_000 }, 'magi-2');
    expect(magiDetail).toBe('promptText: prompt length: clip 1 is 15,001 characters; MAGI-2 takes up to 15,000 per clip');
    expect(magiDetail).not.toContain('Seedance 2.5');
    expect(readPromptLengthRefusal(magiDetail)).toEqual({ clip: 1, chars: 15_001, limit: 15_000, engine: 'MAGI-2' });
    const seedanceDetail = promptLengthRefusalDetail('promptText', { clip: 1, stepId: null, chars: 15_001, limit: 15_000 }, 'seedance-2.5');
    expect(seedanceDetail).toBe('promptText: prompt length: clip 1 is 15,001 characters; Seedance 2.5 takes up to 15,000 per clip');
    expect(readPromptLengthRefusal(seedanceDetail)).toEqual({ clip: 1, chars: 15_001, limit: 15_000 });
  });

  it('writes the numbers with a thousands comma', () => {
    expect(formatPromptChars(SEEDANCE_25_PROMPT_CHARS)).toBe('15,000');
    expect(formatPromptChars(DEFAULT_PROMPT_CHARS)).toBe('8,000');
  });
});
