import { describe, expect, it } from 'vitest';
import { composeFallbackPrompt, seedanceReferenceMode } from '@/lib/brand-studio/enhancer';
import { SHEET, input } from './helpers';

const product = { index: 1, kind: 'image' as const, label: '이미지 1', role: 'product' as const, use: '병 모양과 라벨', avoid: '배경' };
const logo = { index: 1, kind: 'image' as const, label: '이미지 1', role: 'logo' as const };

describe('composeFallbackPrompt — images', () => {
  it('seedream: one paragraph, Image tokens, the product line', () => {
    const r = composeFallbackPrompt(input({ prompt: '이미지 1 병을 대리석 위에', references: [product] }));
    expect(r.source).toBe('fallback');
    expect(r.prompt).not.toContain('\n');
    expect(r.prompt).toMatch(/^Image 1 병을 대리석 위에\./);
    expect(r.prompt).toContain('keep the exact label, proportions and colours of Image 1');
    expect(r.prompt).toContain('take from it: 병 모양과 라벨');
    expect(r.prompt).toContain('do not take: 배경');
    expect(r.notes).toMatch(/[가-힣]/);
  });

  it('seedream with no reference keeps the words as they are', () => {
    expect(composeFallbackPrompt(input({ prompt: '흰 대리석 위의 향수병' })).prompt).toBe('흰 대리석 위의 향수병.');
  });

  it('nano-banana: opens with "Using image 1"', () => {
    const r = composeFallbackPrompt(input({ profile: 'nano-banana', prompt: '병을 대리석 위에', references: [product] }));
    expect(r.prompt.startsWith('Using image 1: ')).toBe(true);
  });

  it('nano-banana region edit: crop is image 1, tray images start at 2', () => {
    const r = composeFallbackPrompt(
      input({ profile: 'nano-banana', kind: 'region_edit', prompt: '로고를 이미지 1 로고로', references: [logo] }),
    );
    expect(r.prompt).toMatch(/^Using image 1, change only this: 로고를 image 2 로고로\./);
    expect(r.prompt).toContain('Do not move or resize anything else.');
    // Nano Banana reads the logo line positively (2026-11-19).
    expect(r.prompt).toContain('Reproduce the mark from image 2 exactly as drawn');
    expect(r.prompt).not.toMatch(/image 3/);
  });

  it('seedream region edit uses Image 1 for the crop', () => {
    const r = composeFallbackPrompt(input({ kind: 'region_edit', prompt: '라벨 글자를 선명하게' }));
    expect(r.prompt).toMatch(/^In Image 1, change only this: 라벨 글자를 선명하게\./);
    expect(r.prompt).toContain('Do not move or resize anything else.');
  });

  it('is deterministic and English notes for en', () => {
    const a = composeFallbackPrompt(input({ locale: 'en', prompt: 'bottle on marble', references: [product] }));
    const b = composeFallbackPrompt(input({ locale: 'en', prompt: 'bottle on marble', references: [product] }));
    expect(a).toEqual(b);
    expect(a.notes).not.toMatch(/[가-힣]/);
  });
});

describe('composeFallbackPrompt — video', () => {
  const video = (over = {}) => ({ seconds: 8, aspect: '9:16', audio: 'native' as const, ...over });

  it('text only: no tokens, a sound line', () => {
    const r = composeFallbackPrompt(input({ profile: 'seedance', kind: 'video', prompt: '병이 천천히 돈다', video: video() }));
    expect(r.prompt).not.toMatch(/@/);
    expect(r.prompt).toMatch(/^Audio: natural location sound and effects, with music/m);
  });

  it('frames only: no tokens, opening and closing frame in words, ambient', () => {
    const r = composeFallbackPrompt(
      input({
        profile: 'seedance',
        kind: 'video',
        prompt: '이미지 1에서 이미지 2로 넘어간다',
        references: [
          { index: 1, kind: 'image', label: '이미지 1', frame: 'start' },
          { index: 2, kind: 'image', label: '이미지 2', frame: 'end' },
        ],
        video: video({ audio: 'ambient' }),
      }),
    );
    expect(r.prompt).not.toMatch(/@Image/);
    expect(r.prompt).toContain('the opening frame에서 the closing frame로');
    expect(r.prompt).toContain('End on the closing frame.');
    expect(r.prompt).toContain('Audio: no music, only location sound and effects.');
  });

  it('reference images: @Image tokens per kind, silent has no sound line', () => {
    const r = composeFallbackPrompt(
      input({
        profile: 'seedance',
        kind: 'video',
        prompt: '이미지 1 병, @2 손',
        references: [product, { index: 2, kind: 'image', label: '이미지 2', role: 'person' }],
        video: video({ audio: 'silent' }),
      }),
    );
    expect(r.prompt).toContain('@Image1 supplies only the product');
    expect(r.prompt).toContain("@Image2 supplies only the person's face");
    expect(r.prompt).toContain('@Image1 병, @Image2 손.');
    expect(r.prompt).not.toMatch(/Audio:/);
  });

  it('remix reference: follow line, kept shots on the timeline ending at the length', () => {
    const r = composeFallbackPrompt(
      input({
        profile: 'seedance',
        kind: 'video_remix',
        prompt: '영상 1처럼',
        references: [
          { index: 1, kind: 'video', label: '영상 1' },
          { index: 2, kind: 'image', label: '이미지 1', role: 'product' },
        ],
        video: video({ seconds: 10, method: 'reference', keep: ['camera', 'timing'], change: '병을 이미지 1 제품으로', sheet: SHEET }),
      }),
    );
    const lines = r.prompt.split('\n');
    expect(lines[0]).toBe('Follow @Video1 for the camera path and the cut timing.');
    expect(r.prompt).toContain('Change: 병을 @Image1 제품으로.');
    expect(r.prompt).toContain('@Image1 supplies only the product');
    // 8 s reference laid on 10 s: cuts at 2.0 → 2.5 and 5.0 → 6.3 (0.1 s), last range ends at 10.0.
    expect(lines).toContain('0.0–2.5s: slow push in toward the bottle. Hard cut.');
    expect(lines).toContain('2.5–6.3s: handheld follow from behind. Hard cut.');
    expect(lines).toContain('6.3–10.0s: locked-off.');
    expect(r.prompt).not.toMatch(/sprays/); // motion was not kept
  });

  it('remix edit: change only, everything else stays, ambient', () => {
    const r = composeFallbackPrompt(
      input({
        profile: 'seedance',
        kind: 'video_remix',
        prompt: '',
        references: [{ index: 1, kind: 'video', label: '영상 1' }],
        video: video({ seconds: null, audio: 'ambient', method: 'edit', change: '라벨 색만 파랗게' }),
      }),
    );
    expect(r.prompt).toMatch(/^In @Video1, change only the following: 라벨 색만 파랗게\./);
    expect(r.prompt).toContain('Everything else stays as it is.');
    expect(r.prompt).toContain('no music, only location sound and effects');
  });
});

describe('seedanceReferenceMode', () => {
  it('chooses the endpoint family from the tray', () => {
    expect(seedanceReferenceMode('video', [])).toBe('text');
    expect(seedanceReferenceMode('video', [{ kind: 'image', frame: 'start' }])).toBe('frames');
    expect(seedanceReferenceMode('video', [{ kind: 'image', frame: 'start' }, { kind: 'image', frame: 'end' }])).toBe('frames');
    expect(seedanceReferenceMode('video', [{ kind: 'image', frame: 'start' }, { kind: 'image' }])).toBe('reference');
    expect(seedanceReferenceMode('video', [{ kind: 'audio' }])).toBe('reference');
    expect(seedanceReferenceMode('video_remix', [{ kind: 'video' }])).toBe('reference');
  });
});
