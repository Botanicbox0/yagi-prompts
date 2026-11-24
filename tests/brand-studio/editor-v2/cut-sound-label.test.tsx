import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionPanel } from '@/components/brand-studio/editor-v2/panels';
import { useEditor } from '@/components/brand-studio/editor-v2/use-editor';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/** Audit A6 (2026-11-24): the cut panel said "이 컷의 소리" twice, as the section title and as its slider's name. */
const COPIES: ReadonlyArray<[string, StudioEditorCopy]> = [
  ['ko', studioEditorKo],
  ['en', studioEditorEn],
];

describe('A6: the cut’s sound section does not say its title twice', () => {
  function cutPanel(copy: StudioEditorCopy): string {
    let api: ReturnType<typeof useEditor> | null = null;
    function Probe() {
      api = useEditor(copy, { real: null, initialWorkspace: 'cut' });
      return null;
    }
    renderToStaticMarkup(h(Probe));
    const seen = api as unknown as ReturnType<typeof useEditor>;
    return renderToStaticMarkup(h(ActionPanel, { api: { ...seen, selection: [seen.sequence.clips[0]!.id] } }));
  }

  for (const [lang, copy] of COPIES) {
    it(`${lang}: the section is "${copy.cut.clip.sound}", its slider "${copy.cut.clip.volume}"`, () => {
      const html = cutPanel(copy);
      expect(html.split(copy.cut.clip.sound).length - 1).toBe(1);
      expect(html).toContain(`<h3>${copy.cut.clip.sound}</h3>`);
      expect(html).toContain(`<span>${copy.cut.clip.volume}</span>`);
      expect(copy.cut.clip.volume).not.toBe(copy.cut.clip.sound);
    });
  }
});
