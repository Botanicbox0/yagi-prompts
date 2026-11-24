/**
 * A8 on screen: a device file on its way up shows the library's own upload indicator and word; one that
 * stays in this tab says so on the cut. The page hands the editor the library's wording.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeviceFileNote } from '@/components/brand-studio/compose/video-composer';
import { getDictionary } from '@/lib/i18n/dictionaries';

describe('device file note', () => {
  for (const locale of ['ko', 'en'] as const) {
    const dict = getDictionary(locale);
    const uploading = dict.brandStudio.assets.uploading;
    const tabOnly = dict.studioCompose.sources.tabOnly;

    it(`${locale}: uploading uses the library's indicator and word; a refused upload says it stays in this tab`, () => {
      const up = renderToStaticMarkup(h(DeviceFileNote, { state: 'uploading', uploading, tabOnly }));
      expect(up).toContain('class="bsr-progress"');
      expect(up).toContain('role="status"');
      expect(up).toContain('class="bsr-progress-bar"');
      expect(up).toContain(`<p>${uploading}</p>`);
      expect(up).not.toContain(tabOnly);

      const stays = renderToStaticMarkup(h(DeviceFileNote, { state: 'tab_only', uploading, tabOnly }));
      expect(stays).toContain('class="bsr-alert"');
      expect(stays).toContain('data-compose-upload-state="tab-only"');
      expect(stays).toContain(tabOnly);

      expect(renderToStaticMarkup(h(DeviceFileNote, { state: undefined, uploading, tabOnly }))).toBe('');
    });
  }

  it('the library indicator classes exist in the stylesheet the editor loads', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/brand-studio/rail/rail.css'), 'utf8');
    for (const cls of ['.bsr-progress ', '.bsr-progress-bar ', '.bsr-alert ']) expect(css).toContain(cls);
    const src = readFileSync(resolve(process.cwd(), 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    expect(src).toContain("import '../rail/rail.css';");
  });

  it('the page passes the library’s upload wording', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/(brand)/brand/studio/compose/page.tsx'), 'utf8');
    expect(page).toMatch(
      /uploadCopy=\{\{\s*uploading: dict\.brandStudio\.assets\.uploading,\s*errors: dict\.brandStudio\.errors,\s*unapprovedUpload: dict\.brandStudio\.unapprovedUpload,\s*uploadFailed: dict\.brandStudio\.uploadFailed,/,
    );
  });
});
