/**
 * The live wiring (lib/brand-studio/runtime.ts) sends every Seedance video prompt to the director
 * (`compileDirectorPrompt`), not to the enhancer. A new version of a generated clip must therefore
 * reach the history-aware revision writer THROUGH the director: these tests pin that, because the
 * director on its own would direct a brand-new scene from a one-line change request.
 */
import { describe, expect, it } from 'vitest';
import { compileDirectorPrompt, composeDirectorFallbackPrompt, type DirectorCompileInput } from '@/lib/brand-studio/director';
import { ENV, input, mockGemini, sentBody } from '../intel/helpers';

// The earlier prompt as the director wrote it: tokens spelled with a space.
const MADE_WITH = 'Reference authority: lock the bottle to @Image 1.\nA pink perfume bottle turns slowly on white stone.\nAudio: soft room tone.';

function editInput(over: Partial<DirectorCompileInput> = {}): DirectorCompileInput {
  return {
    ...input({
      kind: 'video_remix',
      profile: 'seedance',
      prompt: '병을 파란색으로',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
      revision: { mode: 'edit', version: 3, madeWith: MADE_WITH, history: ['배경을 회색으로'] },
    }),
    ...over,
  } as DirectorCompileInput;
}

function reshootInput(over: Partial<DirectorCompileInput> = {}): DirectorCompileInput {
  return {
    ...input({
      kind: 'video',
      profile: 'seedance',
      prompt: '카메라가 병 주위를 반 바퀴 돌게',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
      video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
      revision: { mode: 'reshoot', version: 4, madeWith: MADE_WITH, history: ['병을 파란색으로'] },
    }),
    ...over,
  } as DirectorCompileInput;
}

const payloadOf = (fetchMock: ReturnType<typeof mockGemini>) =>
  JSON.parse((sentBody(fetchMock).contents[0]!.parts[0] as { text: string }).text) as { revision: { madeWith: string; history: string[] } | null; request: string };

describe('a new version of a clip through the director', () => {
  it('edit: the revision writer gets the clip history, and the result uses the director token spelling', async () => {
    const fetchMock = mockGemini({
      prompt: 'In @Video1, change only the pink perfume bottle to deep blue; everything else stays as it is.\nAudio: soft room tone.',
      notes: '병 색만 바꿨어요.',
    });
    const result = await compileDirectorPrompt(editInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });

    expect(result.source).toBe('model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toContain('is version 2 of the clip');
    expect(system).not.toContain('SLOT-FILL');
    const payload = payloadOf(fetchMock);
    // The earlier prompt reaches the writer, in the spelling the enhancer binds references with.
    expect(payload.revision?.madeWith).toContain('@Image1');
    expect(payload.revision?.madeWith).not.toContain('@Image 1');
    expect(payload.revision?.history).toEqual(['배경을 회색으로']);
    // The director's own finish: spaced tokens and its no-music audio line.
    expect(result.prompt).toContain('In @Video 1, change only the pink perfume bottle to deep blue');
    expect(result.prompt).not.toMatch(/@Video1\b/);
    expect(result.prompt).toMatch(/no (?:background )?music/i);
    expect(result.prompt.match(/^Audio:/gim)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(result.prompt).not.toContain(', —');
    expect(result.prompt).not.toContain('Reference authority');
  });

  it('reshoot: the earlier prompt is rewritten, not replaced by a scene directed from the request alone', async () => {
    const fetchMock = mockGemini({
      prompt: 'Reference authority: lock the bottle to @Image1.\nA blue perfume bottle turns as the camera arcs half a circle around it on white stone.\nAudio: soft room tone.',
      notes: '요청을 반영했어요.',
    });
    const result = await compileDirectorPrompt(reshootInput(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });

    expect(result.source).toBe('model');
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toContain('"revision.madeWith" is the complete prompt the clip was generated from');
    expect(payloadOf(fetchMock).revision?.history).toEqual(['병을 파란색으로']);
    expect(result.prompt).toContain('lock the bottle to @Image 1');
    expect(result.prompt).toContain('camera arcs half a circle');
  });

  it('a clip made with the default sound keeps one sound statement and gains no music', async () => {
    const fetchMock = mockGemini({
      prompt: 'Reference authority: lock the bottle to @Image1. A blue perfume bottle turns as the camera arcs around it on white stone. Audio: soft room tone and a glass clink, no background music.',
      notes: '요청을 반영했어요.',
    });
    const native = reshootInput({ video: { seconds: 6, aspect: '9:16', audio: 'native', sheet: null } });
    const result = await compileDirectorPrompt(native, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(result.source).toBe('model');
    expect(result.prompt).not.toMatch(/music that fits/i);
    expect(result.prompt.match(/\bAudio:/g)).toHaveLength(1);
    expect(result.prompt).toMatch(/no background music/i);
  });

  it('without a model: the earlier prompt and the requests, never a fresh direction', async () => {
    const result = await compileDirectorPrompt(reshootInput(), { fetch: (() => { throw new Error('no network'); }) as unknown as typeof fetch, env: {} });
    expect(result.source).toBe('fallback');
    expect(result.prompt).toContain('A pink perfume bottle turns slowly on white stone.');
    expect(result.prompt).toContain('병을 파란색으로');
    expect(result.prompt).toContain('카메라가 병 주위를 반 바퀴 돌게');
    expect(result.prompt).toContain('@Image 1');
    // The synchronous fallback the runtime wires for Seedance agrees.
    const sync = composeDirectorFallbackPrompt(reshootInput());
    expect(sync.prompt).toContain('A pink perfume bottle turns slowly on white stone.');
    expect(sync.prompt).toContain('카메라가 병 주위를 반 바퀴 돌게');
  });

  it('marks become words on this path too, with no circled digit left', async () => {
    const marked = editInput({
      prompt: '① 을 초록색으로',
      revision: {
        mode: 'edit',
        version: 2,
        madeWith: MADE_WITH,
        history: [],
        marks: [{ n: 1, time: 1.2, what: 'the pink perfume bottle on the white stone', x: 0.5, y: 0.4 }],
      },
    } as Partial<DirectorCompileInput>);
    const fetchMock = mockGemini({
      prompt: 'In @Video1, change only the pink perfume bottle on the white stone to green; everything else stays as it is.',
      notes: '병 색만 바꿨어요.',
    });
    const result = await compileDirectorPrompt(marked, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).toContain('revision.marks');
    expect(result.prompt).toContain('the pink perfume bottle on the white stone');
    expect(result.prompt).not.toMatch(/[①-⑳]/);
    expect(composeDirectorFallbackPrompt(marked).prompt).not.toMatch(/[①-⑳]/);
  });

  it('a plain Seedance run is still directed', async () => {
    const fetchMock = mockGemini({
      prompt: 'Visual style: warm morning light.\nA pink perfume bottle turns slowly on white stone.\nAudio: soft room tone.',
      notes: '다듬었어요.',
    });
    await compileDirectorPrompt(reshootInput({ revision: null, references: [] }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    expect(system).not.toContain('is version');
    expect(system).not.toContain('"revision.madeWith" is the complete prompt');
  });
});
