import { describe, expect, it } from 'vitest';
import { guideTokenWarnings } from '@/lib/mcp/guide-warnings';

describe('guideTokenWarnings', () => {
  const baseRecipe = {
    version: 2,
    slots: {
      selfie: { kind: 'image', source: 'user', required: true },
      outfit: { kind: 'image', source: 'creator', asset: `ast_${'a'.repeat(32)}` },
    },
    steps: [
      {
        id: 'still',
        kind: 'image',
        engine: 'gpt-image-2',
        inputs: ['selfie', 'outfit'],
        prompt: 'Portrait of {{selfie}} wearing {{outfit}}.',
        params: { aspect: '4:5' },
      },
    ],
    output: { from: 'still' },
  };

  it('returns no warnings when guide[] is absent or uses only declared slot names and step ids', () => {
    expect(guideTokenWarnings(baseRecipe)).toEqual([]);
    expect(
      guideTokenWarnings({
        ...baseRecipe,
        guide: [
          { title: 'Clip 1', kind: 'video', prompt: 'Show {{ selfie }} in {{outfit}} matching {{still}}.' },
          { title: 'Clip 2', kind: 'image', prompt: 'Pure text prompt with no tokens at all.' },
        ],
      }),
    ).toEqual([]);
  });

  it('warns without blocking when guide[] references undeclared tokens or malformed braces', () => {
    const warnings = guideTokenWarnings({
      ...baseRecipe,
      guide: [
        { title: 'Clip 1', kind: 'video', prompt: 'Valid {{selfie}} only.' },
        { title: 'Clip 2', kind: 'video', prompt: 'Uses {{missing}} and {{missing}} and {{}}.' },
        { title: 'Clip 3', kind: 'video', prompt: 'Has {{Bad Name}} and a stray {{open brace.' },
      ],
    });

    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unknown_guide_token', clip: 2, token: 'missing' }),
      expect.objectContaining({ code: 'unknown_guide_token', clip: 2, token: '' }),
      expect.objectContaining({ code: 'unknown_guide_token', clip: 3, token: 'Bad Name' }),
      expect.objectContaining({ code: 'malformed_guide_token', clip: 3 }),
    ]);
  });

  it('accepts a JSON string or incomplete draft without throwing', () => {
    expect(guideTokenWarnings('not json')).toEqual([]);
    expect(guideTokenWarnings(null)).toEqual([]);
    const fromJson = guideTokenWarnings(
      JSON.stringify({
        slots: { selfie: { kind: 'image', source: 'user', required: true } },
        guide: [{ title: 'Beat 1', kind: 'video', prompt: 'Frame with {{ghost}}.' }],
      }),
    );
    expect(fromJson).toEqual([expect.objectContaining({ code: 'unknown_guide_token', clip: 1, token: 'ghost' })]);
  });
});
