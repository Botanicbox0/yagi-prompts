import { describe, expect, it } from 'vitest';
import { uploadMime } from '@/lib/admin/direct-upload';
import { checkUpload } from '@/lib/prompts/media';

describe('audio types as browsers report them', () => {
  it.each([
    ['a.m4a', 'audio/x-m4a', 'audio/mp4'],
    ['a.m4a', 'audio/m4a', 'audio/mp4'],
    ['a.mp3', 'audio/mp3', 'audio/mpeg'],
    ['a.aac', 'audio/x-aac', 'audio/aac'],
    ['a.aac', 'audio/vnd.dlna.adts', 'audio/aac'],
    ['a.flac', 'audio/x-flac', 'audio/flac'],
    ['a.wav', 'audio/wave', 'audio/wav'],
  ])('%s reported as %s uploads as %s', (name, reported, canonical) => {
    expect(uploadMime(name, reported)).toBe(canonical);
    expect(checkUpload({ kind: 'audio', mime: reported, sizeBytes: 1024, durationSeconds: null })).toBeNull();
  });

  it('still refuses what is not audio', () => {
    expect(checkUpload({ kind: 'audio', mime: 'text/html', sizeBytes: 1024, durationSeconds: null })).toBe('bad_type');
    expect(uploadMime('a.png', 'image/png')).toBe('image/png');
  });
});
