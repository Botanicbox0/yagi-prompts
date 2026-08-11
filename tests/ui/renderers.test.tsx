import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlockView } from '@/components/playbook/blocks';
import { StepChips, StepIndex } from '@/components/playbook/step-index';
import { playbookLabels } from '@/components/playbook/labels';
import { Markdown } from '@/components/playbook/markdown';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { ShapedAssetRef, ShapedBlock, ShapedStep } from '@/lib/content/shape';
import { BLOCK_KINDS } from '@/lib/content/schemas';

/**
 * PLAN §6.1 — "these schemas define the M4 form fields and the M2 renderer props verbatim".
 *
 * One test per kind, asserting that the fields the contract names actually reach the page, plus the
 * §5.5 locked variant asserting the opposite: that NOTHING reaches it. Rendered with
 * `react-dom/server` — no jsdom, no testing-library, no new dependency; every renderer is a pure
 * synchronous component precisely so this is possible.
 */

const labels = playbookLabels(getDictionary('en'));
const koLabels = playbookLabels(getDictionary('ko'));

const asset: ShapedAssetRef = {
  source: 'gateway',
  src: '/api/media/block-asset',
  mime: 'image/png',
  w: 1024,
  h: 768,
};

const unlocked = (kind: ShapedBlock['kind'], content: unknown): ShapedBlock =>
  ({
    id: `block-${kind}`,
    order: 1,
    kind,
    visibility: 'public',
    locked: false,
    content,
  }) as ShapedBlock;

const render = (block: ShapedBlock, locale = 'en', canCopy = true) =>
  renderToStaticMarkup(
    <BlockView block={block} locale={locale} labels={labels} canCopy={canCopy} />,
  );

describe('block renderers — one per §6.1 content contract', () => {
  it('prompt: monospace text, model, negative, and a copy control', () => {
    const html = render(
      unlocked('prompt', {
        kind: 'prompt',
        text: 'character sheet, 6 poses',
        model: 'GPT Image 2',
        negative: 'blurry, watermark',
      }),
    );
    expect(html).toContain('character sheet, 6 poses');
    expect(html).toContain('GPT Image 2');
    expect(html).toContain('blurry, watermark');
    expect(html).toContain('font-mono');
    expect(html).toContain('>Copy<');
    expect(html).toContain('data-block-kind="prompt"');
  });

  it('offers the copy control to Pro only — an unlocked prompt still reads for everyone', () => {
    const prompt = unlocked('prompt', { kind: 'prompt', text: 'the prompt' });
    const forPro = render(prompt, 'en', true);
    const forFree = render(prompt, 'en', false);
    expect(forPro).toContain('>Copy<');
    expect(forFree).not.toContain('>Copy<');
    // the content itself is unaffected — the gate is the server's render decision, not this button
    expect(forFree).toContain('the prompt');
  });

  it('params: a key/value table with every row', () => {
    const html = render(
      unlocked('params', {
        kind: 'params',
        rows: [
          { k: 'size', v: '1536x1024' },
          { k: 'cfg', v: '4.5' },
        ],
      }),
    );
    expect(html).toContain('<table');
    for (const value of ['size', '1536x1024', 'cfg', '4.5']) expect(html).toContain(value);
  });

  it('asset: media element plus the localized caption', () => {
    const html = render(
      unlocked('asset', {
        kind: 'asset',
        asset,
        caption: { en: 'Output sheet', ko: '결과 시트' },
      }),
    );
    expect(html).toContain('<img');
    expect(html).toContain('/api/media/block-asset');
    expect(html).toContain('width="1024"');
    expect(html).toContain('Output sheet');
    expect(html).toContain('<figcaption');

    const ko = renderToStaticMarkup(
      <BlockView
        block={unlocked('asset', {
          kind: 'asset',
          asset,
          caption: { en: 'Output sheet', ko: '결과 시트' },
        })}
        locale="ko"
        labels={koLabels}
      />,
    );
    expect(ko).toContain('결과 시트');
    expect(ko).not.toContain('Output sheet');
  });

  it('asset: video mime renders a video element, not a broken image', () => {
    const html = render(
      unlocked('asset', {
        kind: 'asset',
        asset: { ...asset, mime: 'video/mp4' },
      }),
    );
    expect(html).toContain('<video');
    expect(html).not.toContain('<img');
  });

  it('note: markdown becomes elements, never raw HTML', () => {
    const html = render(
      unlocked('note', {
        kind: 'note',
        md: { en: '**Crop** to the shoulders.\n\n- 1024px minimum', ko: '**어깨선**까지.' },
      }),
    );
    expect(html).toContain('<strong');
    expect(html).toContain('Crop');
    expect(html).toContain('<ul');
    expect(html).toContain('1024px minimum');
    expect(html).not.toContain('**');
  });

  it('link: label, href and host', () => {
    const html = render(
      unlocked('link', {
        kind: 'link',
        url: 'https://example.com/reference-guide',
        label: { en: 'Reference guide', ko: '레퍼런스 가이드' },
      }),
    );
    expect(html).toContain('href="https://example.com/reference-guide"');
    expect(html).toContain('Reference guide');
    expect(html).toContain('example.com');
  });

  it('workflow_file: filename, format, size and a download that hits the gateway', () => {
    const html = render(
      unlocked('workflow_file', {
        kind: 'workflow_file',
        asset: { ...asset, mime: 'application/json' },
        filename: 'character-sheet.json',
        size_bytes: 4096,
        format: 'comfyui',
      }),
    );
    expect(html).toContain('character-sheet.json');
    expect(html).toContain('COMFYUI');
    expect(html).toContain('4 KB');
    expect(html).toContain('download="character-sheet.json"');
    expect(html).toContain('href="/api/media/block-asset"');
  });

  it('covers every kind in BLOCK_KINDS — a new kind cannot ship without a renderer', () => {
    const contentFor: Record<string, unknown> = {
      prompt: { kind: 'prompt', text: 'x' },
      params: { kind: 'params', rows: [{ k: 'a', v: 'b' }] },
      asset: { kind: 'asset', asset },
      note: { kind: 'note', md: { en: 'x', ko: 'x' } },
      link: { kind: 'link', url: 'https://example.com', label: { en: 'x', ko: 'x' } },
      workflow_file: {
        kind: 'workflow_file',
        asset,
        filename: 'g.json',
        size_bytes: 1,
        format: 'comfyui',
      },
    };
    for (const kind of BLOCK_KINDS) {
      const html = render(unlocked(kind, contentFor[kind]));
      expect(html, kind).toContain(`data-block-kind="${kind}"`);
      expect(html, kind).toContain('data-locked="false"');
    }
  });
});

describe('locked block (§5.5) — full chrome, zero content bytes', () => {
  const locked = (kind: ShapedBlock['kind']): ShapedBlock => ({
    id: 'block-locked',
    order: 3,
    kind,
    visibility: 'pro',
    locked: true,
  });

  it('keeps the kind label and the frame, and adds the flat lock panel', () => {
    const html = render(locked('prompt'));
    expect(html).toContain('data-locked="true"');
    expect(html).toContain('data-block-kind="prompt"');
    expect(html).toContain('data-lock-panel');
    expect(html).toContain('lock-panel');
    // §5.5: kind label, the $9 CTA, and a text-swap hover on it
    expect(html).toContain('Prompt');
    expect(html).toContain('Prompt — unlock with Pro');
    expect(html).toContain('Unlock every prompt — $9/mo');
    expect(html).toContain('text-swap');
    expect(html).toContain('/en/pricing');
    // the accent glyph, on the surface's own accent variable
    expect(html).toContain('<svg');
    expect(html).toContain('text-accent');
  });

  it('renders no teaser and no payload for any kind', () => {
    for (const kind of BLOCK_KINDS) {
      const html = render(locked(kind));
      // A locked ShapedBlock has no `content` at all, so there is nothing to leak — this asserts
      // the renderer does not invent a placeholder from the kind either.
      expect(html, kind).not.toMatch(/blur|opacity-0|aria-hidden="true">\s*[a-z]{20}/);
      expect(html, kind).toContain('data-locked="true"');
    }
  });

  it('names the locked kind in the reader language', () => {
    const html = renderToStaticMarkup(
      <BlockView block={locked('workflow_file')} locale="ko" labels={koLabels} />,
    );
    expect(html).toContain('워크플로 파일');
    expect(html).toContain('/ko/pricing');
  });
});

describe('step index lock counts (§5.5 "Step 3 · 2 locked")', () => {
  const step = (order: number, lockedCount: number): ShapedStep => ({
    id: `step-${order}`,
    order,
    title: { en: `Step title ${order}`, ko: `스텝 제목 ${order}` },
    body: null,
    blocks: [],
    lockedCount,
  });

  const steps = [step(1, 0), step(2, 1), step(3, 2)];

  it('shows a count only where something is locked', () => {
    const html = renderToStaticMarkup(<StepIndex steps={steps} locale="en" labels={labels} />);
    expect(html).toContain('Step 3');
    expect(html).toContain('2 locked');
    expect(html).toContain('1 locked');
    expect((html.match(/locked/g) ?? []).length).toBe(2);
    expect(html).toContain('href="#step-3"');
  });

  it('is sticky at ≥1024 and a chip bar below, both server-rendered (§3.3 / §4)', () => {
    const index = renderToStaticMarkup(<StepIndex steps={steps} locale="en" labels={labels} />);
    const chips = renderToStaticMarkup(<StepChips steps={steps} locale="en" labels={labels} />);
    expect(index).toContain('step-index');
    expect(index).toContain('hidden lg:block');
    expect(chips).toContain('lg:hidden');
    // identical information in both variants — the small tier is not a degraded product
    expect(chips).toContain('2 locked');
  });
});

describe('markdown renderer safety', () => {
  it('drops a javascript: href rather than rendering it', () => {
    const html = renderToStaticMarkup(
      <Markdown source="see [this](javascript:alert(1)) and [that](https://ok.example)" />,
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('this');
    expect(html).toContain('https://ok.example');
  });

  it('escapes authored HTML instead of executing it', () => {
    const html = renderToStaticMarkup(<Markdown source={'<img src=x onerror=alert(1)>'} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
