import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  WorkflowsHub,
  isLockedWorkflow,
  lockedDefaultFolder,
  lockedRunInputs,
  type WorkflowsHubProps,
} from '@/components/brand-studio/workflows/workflows-hub';
import { initialDraft, rerunInput } from '@/components/brand-studio/dock-model';
import { planReuse } from '@/components/brand-studio/reuse-model';
import { Wall, tileMenuKeys, type WallProps } from '@/components/brand-studio/gallery/wall';
import { Viewer, canRerun, type ViewerActions } from '@/components/brand-studio/viewer';
import { promptToCopy } from '@/components/brand-studio/copy-prompt';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import type { WorkflowWire } from '@/lib/brand-studio/workflows/contracts';
import { STARTER_WORKFLOWS } from '@/lib/brand-studio/workflows/starters';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG, asset, copyFor, id, job, output } from './ui/fixtures';

/**
 * `영상화용 캐릭터 시트 생성기` on screen (docs/STUDIO-PRO-SUITE-V4.md): the hub's locked runner (two picture slots,
 * the why block, no free text, no output packs, no model), and the gallery never offering a re-run or a settings
 * reuse of a preset run (its sent text is a server-side preset; the visible line is only a label).
 */

const SHEET = STARTER_WORKFLOWS.find((w) => w.slug === 'video-character-sheet')!;
const OTHERS = STARTER_WORKFLOWS.filter((w) => w.slug !== 'video-character-sheet');

/** React's text escaping, so copy with an apostrophe can be looked for in markup. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function hub(locale: 'ko' | 'en', starters: readonly WorkflowWire[], patch: Partial<WorkflowsHubProps> = {}): string {
  const props: WorkflowsHubProps = {
    organizationId: ORG,
    locale,
    canCreate: true,
    copy: getDictionary(locale).studioWorkflows,
    imageStudioHref: '/brand/studio',
    videoStudioHref: '/brand/studio/video',
    assetsHref: '/brand/library',
    initialAllowance: { capKrw: 490_000, usedKrw: 40_000, resetsAt: '2026-12-01T00:00:00.000Z' },
    initialStarters: [...starters],
    initialWorkflows: [],
    initialPlaybooks: [],
    initialRecentRuns: [],
    initialImageAssets: [asset(1, { name: '모델 정면 컷' }), asset(2, { name: '착장 전신 컷' })],
    initialVideoAssets: [],
    initialImageOutputs: [{ ...output(3), label: '최근 결과 한 장' }],
    initialMcpTokens: [],
    ...patch,
  };
  return renderToStaticMarkup(<WorkflowsHub {...props} />);
}

/** The runner panel only (the hub renders one). */
function runnerOf(html: string): string {
  const start = html.indexOf('<aside');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</aside>', start) + '</aside>'.length);
}

/** The card of one workflow. */
function cardOf(html: string, slug: string): string {
  const start = html.indexOf(`data-workflow-card="${slug}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</article>', start));
}

/** What a customer reads: text nodes and the attributes a screen reader or a field shows. */
function readable(html: string): string {
  const attrs = [...html.matchAll(/\s(?:placeholder|alt|aria-label|title)="([^"]*)"/g)].map((m) => m[1]);
  return `${html.replace(/<[^>]+>/g, ' ')} ${attrs.join(' ')}`;
}

const SPEC = {
  ko: {
    title: '영상화용 캐릭터 시트 생성기',
    summary: '인물과 의상 사진으로 영상 제작용 캐릭터 시트를 만듭니다. 16:9 이미지 한 장에 얼굴 클로즈업, 전신 앞모습과 뒷모습 세 칸을 담습니다.',
    guide: '인물과 의상 사진 2장을 넣으면 16:9 2K 시트 1장이 만들어집니다. 영상 제작 시 참조 이미지로 사용합니다.',
    image1: ['인물 사진', '얼굴이 선명하게 나온 사진을 골라 주세요. 옷은 반영되지 않습니다.'],
    image2: ['의상 사진', '입힐 옷이 전체적으로 보이는 사진을 골라 주세요. 옷만 반영됩니다.'],
    name: ['인물 이름', '예: 소라, 루카스, 26FW 버추얼 모델'],
    whyTitle: '왜 이렇게 구성했나요?',
    why: [
      ['얼굴은 한 칸에만 크게', '얼굴 기준이 하나여야 영상 속 얼굴이 일정하게 나옵니다.'],
      ['전신 칸에는 머리 제외', '작은 얼굴이 여러 개 있으면 서로 섞여 다른 얼굴이 될 수 있습니다.'],
      ['회색 배경과 조명 하나', '시트의 색감이나 그림자가 영상 장면으로 옮겨가지 않게 합니다.'],
      ['앞모습과 뒷모습 모두 포함', '인물이 돌아설 때 옷의 뒷면이 바뀌지 않고 유지됩니다.'],
    ],
    step: '세 칸 캐릭터 시트 (16:9 · 2K)',
    missing: '인물 사진과 의상 사진을 모두 선택해 주세요.',
    afterRun: '결과물은 보관함 폴더에 저장됩니다. 영상 스튜디오에서 참조 이미지로 사용할 수 있습니다.',
    upload: '파일 올리기',
  },
  en: {
    title: 'Character Sheet for Video',
    summary:
      'One photo of the person and one of the outfit become a single 16:9 sheet with three panels: a face close-up, the full body from the front, and from the back.',
    guide: 'Pick a photo of the person and a photo of the outfit. You get one 16:9 sheet at 2K to attach as a reference when you make a video.',
    image1: ['Person photo', 'Choose a photo where the face is clear. The clothes in it are not used.'],
    image2: ['Outfit photo', 'Choose a photo that shows the whole outfit. Only the clothes are used.'],
    name: ['Name', 'e.g. Sora, Lucas, 26FW Campaign Persona'],
    whyTitle: 'Why the sheet looks like this',
    why: [
      ['One large face, one panel', 'With a single face to follow, the face in the video stays the same.'],
      ['No head on the body panels', 'Several small faces can blend into a face that matches none of them.'],
      ['Grey backdrop, one light', "The sheet's colour and shadows do not carry over into your scene."],
      ['Front and back', 'When the person turns, the back of the outfit stays the same.'],
    ],
    step: 'Three-panel character sheet (16:9 · 2K)',
    missing: 'Choose both a person photo and an outfit photo.',
    afterRun: 'The sheet is saved to a library folder. You can attach it as a reference in the video studio.',
    upload: 'Upload a file',
  },
} as const;

describe('workflows hub — the video character sheet starter', () => {
  it('knows which workflow is locked: a built-in starter with a preset step, nothing else', () => {
    expect(isLockedWorkflow(SHEET)).toBe(true);
    for (const wf of OTHERS) expect(isLockedWorkflow(wf)).toBe(false);
    // A team copy of the same recipe runs as an ordinary workflow (the server ignores its preset too).
    const teamCopy: WorkflowWire = { ...SHEET, starter: false, source: 'web', id: id(0x51) };
    expect(isLockedWorkflow(teamCopy)).toBe(false);
  });

  it('shows its card with title, summary, the one step and 15 credits, in both languages', () => {
    for (const locale of ['ko', 'en'] as const) {
      const s = SPEC[locale];
      const card = cardOf(hub(locale, STARTER_WORKFLOWS), 'video-character-sheet');
      expect(card).toContain(esc(s.title));
      expect(card).toContain(esc(s.summary));
      expect(card).toContain(esc(s.step));
      expect(card).toContain(locale === 'ko' ? '약 15 크레딧' : '~15 credits');
      expect(card).not.toMatch(/gpt|sunburst|sunra/i);
    }
  });

  it('opens a runner of guide, why block, two picture slots, name and folder; no free text, no packs, no model', () => {
    for (const locale of ['ko', 'en'] as const) {
      const s = SPEC[locale];
      const copy = getDictionary(locale).studioWorkflows;
      const html = runnerOf(hub(locale, [SHEET, ...OTHERS]));
      expect(html).toContain('data-workflow-runner="video-character-sheet"');

      // Order: guide → why → Image 1 → Image 2 → name → folder → cost and run.
      const at = (needle: string) => {
        const i = html.indexOf(needle);
        expect(i, needle).toBeGreaterThan(-1);
        return i;
      };
      const order = [
        at(esc(s.guide)),
        at('data-workflow-why'),
        at('data-workflow-slot="image1"'),
        at('data-workflow-slot="image2"'),
        at('id="wf-subject-input"'),
        at('id="wf-folder-input"'),
        at('data-workflow-run-cta'),
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      // The why block: its title, the four rows and the drawing (decorative, no text in it).
      expect(html).toContain(esc(s.whyTitle));
      for (const [title, body] of s.why) {
        expect(html).toContain(esc(title));
        expect(html).toContain(esc(body));
      }
      expect(html).toMatch(/data-workflow-sheet-schematic="true" aria-hidden="true"/);
      const schematic = html.slice(html.indexOf('>', html.indexOf('data-workflow-sheet-schematic')) + 1);
      const drawing = schematic.slice(0, schematic.indexOf('</div>'));
      expect(drawing).toMatch(/^<span/);
      expect(drawing.replace(/<[^>]+>/g, '').trim()).toBe('');

      // Each picture slot: its label bound to the picker, its hint, the library and recent pictures, an upload button.
      for (const [slot, [label, hint]] of [['image1', s.image1], ['image2', s.image2]] as const) {
        const start = html.indexOf(`data-workflow-slot="${slot}"`);
        const block = html.slice(start, html.indexOf('data-workflow-slot=', start + 10) > -1 ? html.indexOf('data-workflow-slot=', start + 10) : undefined);
        expect(block).toContain(`for="wf-${slot}-picker"`);
        expect(block).toContain(`id="wf-${slot}-picker"`);
        expect(block).toContain(`>${esc(label)}</label>`);
        expect(block).toContain(esc(hint));
        expect(block).toContain(`value="asset:${asset(1).id}"`);
        expect(block).toContain(`value="asset:${asset(2).id}"`);
        expect(block).toContain(`value="output:${output(3).id}"`);
        expect(block).toMatch(new RegExp(`<button type="button"[^>]*data-workflow-upload="${slot}"[^>]*>${esc(s.upload)}</button>`));
        expect(block).toMatch(/<input[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
      }

      // The name field uses the recipe's label and example; no default name.
      expect(html).toContain(`>${esc(s.name[0])}</label>`);
      expect(html).toContain(`placeholder="${esc(s.name[1])}"`);
      expect(html).toMatch(/id="wf-subject-input"[^>]*value=""/);

      // Cost: one job, 15 credits. Run waits for both pictures.
      expect(html).toContain(copy.runner.estimateValue.replace('{credits}', '15').replace('{count}', '1'));
      expect(html).toMatch(/<button type="button" data-workflow-run-cta="true"[^>]*aria-disabled="true"/);
      expect(html).not.toContain(esc(s.missing));
      expect(html).not.toContain(esc(s.afterRun));

      // Not here: the direction text, the output packs, the video picker, the old picture picker, the step list.
      expect(html).not.toContain('wf-prompt-input');
      expect(html).not.toContain('<textarea');
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain('wf-video1-select');
      expect(html).not.toContain('wf-image1-select');
      expect(html).not.toContain(esc(copy.runner.packsLabel));
      expect(html).not.toContain(esc(copy.runner.promptLabel));
      expect(html).not.toContain(esc(copy.runner.pickNone));
      expect(html).not.toContain(esc(copy.runner.stepsHeading));
      // No model, no vendor, no picker, and no prompt / engine / pipeline wording.
      expect(html).not.toContain('gpt-image-2.6-sunburst');
      expect(html).not.toMatch(/gpt|sunburst|sunra/i);
      expect(readable(html)).not.toMatch(/프롬프트|엔진|파이프라인|prompt|engine|pipeline/i);
    }
  });

  it('builds the run request from both pictures only, and refuses without both', () => {
    expect(lockedRunInputs({ image1: '', image2: `asset:${asset(2).id}` }, '', '')).toEqual({ ok: false });
    expect(lockedRunInputs({ image1: `asset:${asset(1).id}`, image2: '' }, '소라', '')).toEqual({ ok: false });
    expect(lockedRunInputs({ image1: `asset:${asset(1).id}`, image2: `output:${output(3).id}` }, '  소라 ', ' 26FW ')).toEqual({
      ok: true,
      inputs: { image1Ref: { assetId: asset(1).id }, image2Ref: { outputId: output(3).id }, subject: '소라', folderName: '26FW' },
    });
    const bare = lockedRunInputs({ image1: `asset:${asset(1).id}`, image2: `asset:${asset(2).id}` }, ' ', '');
    expect(bare).toEqual({ ok: true, inputs: { image1Ref: { assetId: asset(1).id }, image2Ref: { assetId: asset(2).id } } });
    // Never a free text or a pack list.
    expect(Object.keys(bare.ok ? bare.inputs : {})).not.toContain('prompt');
    expect(Object.keys(bare.ok ? bare.inputs : {})).not.toContain('packs');
  });

  it('keeps the runner of every other workflow as it was', () => {
    const copy = getDictionary('ko').studioWorkflows;
    for (const wf of OTHERS) {
      const html = runnerOf(hub('ko', [wf, ...STARTER_WORKFLOWS.filter((x) => x.id !== wf.id)]));
      expect(html).toContain(`data-workflow-runner="${wf.slug}"`);
      expect(html).toContain('wf-prompt-input');
      expect(html).toContain('wf-image1-select');
      expect(html).toContain(esc(copy.runner.stepsHeading));
      expect(html).not.toContain('data-workflow-why');
      expect(html).not.toContain('data-workflow-slot');
      expect(html).not.toContain('data-workflow-upload');
      expect(html).not.toContain('aria-disabled');
      expect(html).not.toContain(SPEC.ko.upload);
    }
    // The flagship keeps its pack checkboxes.
    expect(runnerOf(hub('ko', STARTER_WORKFLOWS))).toContain('type="checkbox"');
    // A team workflow too.
    const team: WorkflowWire = { ...OTHERS[0]!, id: id(0x52), slug: 'team-one', starter: false, source: 'web' };
    const teamHtml = runnerOf(hub('ko', [], { initialWorkflows: [team] }));
    expect(teamHtml).toContain('wf-prompt-input');
    expect(teamHtml).not.toContain('data-workflow-why');
  });

  it('adds only generic labels to the dictionary, the same keys in both languages', () => {
    const ko = getDictionary('ko').studioWorkflows.runner;
    const en = getDictionary('en').studioWorkflows.runner;
    expect(ko.missingPictures).toBe(SPEC.ko.missing);
    expect(en.missingPictures).toBe(SPEC.en.missing);
    expect(ko.afterRun).toBe(SPEC.ko.afterRun);
    expect(en.afterRun).toBe(SPEC.en.afterRun);
    expect(ko.uploadButton).toBe(SPEC.ko.upload);
    expect(en.uploadButton).toBe(SPEC.en.upload);
  });
});

/* ------------------------------------------------------------- the gallery */

const presetRun = (patch: Partial<StudioJobView> = {}): StudioJobView =>
  job(40, {
    prompt: '영상화용 캐릭터 시트 · 소라',
    // The view of a preset run never carries its sent text (repo.ts jobView).
    finalPrompt: null,
    preset: 'video-character-sheet',
    aspect: '16:9',
    resolution: '2K',
    quality: 'high',
    model: 'gpt-image-2.6-sunburst',
    references: [{ assetId: asset(1).id, role: 'person' }, { assetId: asset(2).id, role: 'style' }],
    ...patch,
  });
const ids = () => ({ organizationId: ORG, requestId: crypto.randomUUID() });
const noop = () => {};
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };

function viewer(run: StudioJobView): string {
  const out = run.outputs[0] ?? output(41);
  return renderToStaticMarkup(
    <Viewer items={[{ type: 'output', output: out, job: { ...run, outputs: [out] } }]} index={0} copy={copyFor('ko')} locale="ko" canCreate canGenerate busy={null} notice={null}
      parentOf={() => null} onIndex={noop} onClose={noop} actions={{ ...actions, openRegionInLayers: noop, decorate: noop }} />,
  );
}

const library: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set<string>(),
  likedItems: [],
  folderItems: () => null,
  openFolder: () => {},
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};
function wall(jobs: StudioJobView[]): string {
  const props: WallProps = {
    mode: 'image',
    jobs,
    copy: copyFor('ko'),
    locale: 'ko',
    canGenerate: true,
    canEdit: true,
    canStop: true,
    library,
    now: new Date('2026-11-11T03:00:00Z'),
    parentOf: () => null,
    onAction: noop,
    onRetry: noop,
    onCancel: noop,
    onNotice: noop,
  };
  return renderToStaticMarkup(<Wall {...props} />);
}

describe('gallery — a preset run is never made again from the gallery', () => {
  it('rerunInput and planReuse build nothing for it, and behave as before for an ordinary run', () => {
    expect(rerunInput(presetRun(), ids())).toBeNull();
    expect(rerunInput(job(1, { aspect: '16:9', resolution: '2K' }), ids())).toMatchObject({ kind: 'image', prompt: 'Prompt 1' });

    const ctx = { current: initialDraft(), lookup: { asset: () => null, output: () => null }, outputName: '결과' };
    expect(planReuse(presetRun(), ctx)).toEqual({ to: 'none' });
    expect(planReuse(job(1), ctx).to).toBe('dock');
    expect(canRerun(presetRun())).toBe(false);
    expect(canRerun(job(1))).toBe(true);
  });

  it('the tile menu offers no 다시 만들기 or 설정 다시 쓰기 for it, everything else as usual', () => {
    const base = { kind: 'image' as const, image: true, sized: true, saved: false, copyable: true, canGenerate: true, canEdit: true };
    const usual = tileMenuKeys(base);
    expect(usual).toContain('rerun');
    expect(usual).toContain('reuse');
    const keys = tileMenuKeys({ ...base, preset: true });
    expect(keys).toEqual(usual.filter((k) => k !== 'rerun' && k !== 'reuse'));
    for (const kept of ['open', 'copy-prompt', 'region', 'decorate', 'to-video', 'folder', 'review', 'campaign', 'save', 'download', 'delete'] as const)
      expect(keys).toContain(kept);
    expect(tileMenuKeys({ ...base, preset: true, inMenu: { reference: true, like: true } })).toEqual(expect.arrayContaining(['reference', 'like']));
  });

  it('the viewer hides 다시 만들기, 설정 다시 쓰기 and the sent-text block; keeps edit, video, reference, copy and download', () => {
    const v = copyFor('ko').viewer;
    const html = viewer(presetRun());
    expect(html).not.toContain('data-action="rerun"');
    expect(html).not.toContain('data-studio-reuse');
    // The sent-text block (and the toggle that opens it) is not there at all.
    expect(html).not.toContain('data-studio-prompt-details');
    expect(html).not.toContain(v.promptToggle);
    expect(html).not.toContain(v.sentPrompt);
    expect(html).not.toContain(v.notEnhanced);
    expect(html).not.toContain('data-copy-sent');
    for (const kept of ['region', 'decorate', 'to-video', 'reference', 'download']) expect(html).toContain(`data-action="${kept}"`);
    // Copy prompt stays and copies the short visible line.
    expect(html).toContain('data-copy-prompt');
    expect(promptToCopy(presetRun())).toBe('영상화용 캐릭터 시트 · 소라');
    expect(html).not.toMatch(/gpt-image|sunburst/i);

    // An ordinary image run keeps all of them.
    const usual = viewer(job(1, { outputs: [output(1)] }));
    expect(usual).toContain('data-action="rerun"');
    expect(usual).toContain('data-studio-reuse="dock"');
    expect(usual).toContain(v.sentPrompt);
  });

  it('a failed preset run has no retry button on the wall; an ordinary failed run keeps it', () => {
    const retry = 'bs-tile-retry';
    expect(wall([presetRun({ status: 'failed', errorCode: 'failed' })])).not.toContain(retry);
    expect(wall([job(2, { status: 'failed', errorCode: 'failed' })])).toContain(retry);
  });
});

describe('workflows hub — the folder a locked run files under', () => {
  it('is the recipe pattern with the typed name, or the pattern base without one (the server rule)', () => {
    expect(lockedDefaultFolder(SHEET.recipe, '', 'ko')).toBe('영상용 시트');
    expect(lockedDefaultFolder(SHEET.recipe, '  소라 ', 'ko')).toBe('영상용 시트 · 소라');
    expect(lockedDefaultFolder(SHEET.recipe, '', 'en')).toBe('Video Sheet');
    expect(lockedDefaultFolder(SHEET.recipe, 'Sora', 'en')).toBe('Video Sheet · Sora');
    // A Korean name on an English screen files under the Korean pattern, as the server does.
    expect(lockedDefaultFolder(SHEET.recipe, '소라', 'en')).toBe('영상용 시트 · 소라');
    expect(lockedDefaultFolder(undefined, '소라', 'ko')).toBe('');
  });

  it('shows that folder as the placeholder of the folder field, not the example of another starter', () => {
    const html = hub('ko', [SHEET, ...OTHERS]);
    expect(html).toContain('placeholder="영상용 시트"');
    expect(html).not.toContain('placeholder="예: 캐릭터 시트 · 소라"');
    expect(hub('en', [SHEET, ...OTHERS])).toContain('placeholder="Video Sheet"');
  });
});
