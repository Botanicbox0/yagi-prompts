import { describe, expect, it } from 'vitest';
import * as f from '@/lib/admin/form';

/**
 * The multipart boundary between a real upload and an untouched file input.
 *
 * This is a REGRESSION test with a bug behind it (2026-08-14). An untouched `<input type="file">`
 * still posts a part, and React's server-action encoding hands it to the server as a File that is
 * NAMED (`blob`) with zero bytes and no type. The old guard ignored an empty part only when its
 * name was also empty, so every admin save that did not re-upload media went to
 * `stagePromptUpload`, failed the MIME whitelist as `application/octet-stream`, and refused the
 * WHOLE operation with `upload: poster bad_type` — the founder's "저장이 안 된다".
 *
 * The rule pinned here is the honest one: a real upload always has bytes.
 */
describe('form.file — an empty part is not an upload', () => {
  const formWith = (value: File | string): FormData => {
    const form = new FormData();
    form.set('poster', value);
    return form;
  };

  it('ignores a zero-byte part however it is named', () => {
    for (const name of ['', 'blob', 'poster.png', 'undefined']) {
      const empty = new File([], name, ...(name.endsWith('.png') ? [{ type: 'image/png' }] : []));
      expect(f.file(formWith(empty), 'poster'), name).toBeNull();
    }
  });

  it('still returns a real file', () => {
    const real = new File([new Uint8Array([1, 2, 3])], 'poster.png', { type: 'image/png' });
    expect(f.file(formWith(real), 'poster')).toBe(real);
  });

  it('answers null for an absent field and for a plain string value', () => {
    expect(f.file(new FormData(), 'poster')).toBeNull();
    expect(f.file(formWith('not-a-file'), 'poster')).toBeNull();
  });
});
