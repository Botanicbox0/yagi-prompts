import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  canUndoEntry,
  entryHistory,
  type AssistEntry,
  type HistoryView,
} from '@/components/brand-studio/compose/assist/assist-model';
import { AssistPanel, AssistPreviewBar } from '@/components/brand-studio/compose/assist/assist-panel';
import { askChoiceText, askQuestion, deltaText, noteText } from '@/components/brand-studio/compose/assist/delta-lines';
import type { AssistPanelModel } from '@/components/brand-studio/compose/assist/use-edit-assist';
import { applyTimelinePatches } from '@/lib/brand-studio/compose/timeline';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { studioComposeEn, studioComposeKo, type StudioComposeCopy } from '@/messages/studio-compose';
import { assistFixture } from './fixture';

const noop = () => {};

/** What React writes for text and attribute values. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function unesc(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Every text node of the markup, trimmed and unescaped. */
function textNodes(html: string): string[] {
  return [...html.matchAll(/>([^<]+)</g)].map((m) => unesc(m[1]!).trim()).filter(Boolean);
}

/** The opening tag of the first element carrying `marker`. */
function tagWith(html: string, marker: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`));
  if (!match) throw new Error(`no element with ${marker}`);
  return match[0];
}

const project = assistFixture();
const base = project;
const trimmed = applyTimelinePatches(base, [{ op: 'trim_clip', clipIndex: 1, trimEndSec: 3 }]).project;
const later = applyTimelinePatches(trimmed, [{ op: 'set_aspect', aspect: '1:1' }]).project;

const trimDeltas: EditDelta[] = [
  { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 },
  { kind: 'total', beforeSec: 20, afterSec: 17 },
];
const removeDeltas: EditDelta[] = [
  { kind: 'clip_removed', cut: 4, label: '로고 엔딩' },
  { kind: 'caption_added', text: '지금 만나보세요', fromSec: 13.5, toSec: 16 },
  { kind: 'total', beforeSec: 20, afterSec: 16 },
];

const USER_TEXT = ['두 번째 컷을 2초로 줄여줘', '로고 컷 지우고 자막 넣어줘', '줄여줘'];

function fixtureEntries(): AssistEntry[] {
  return [
    { id: 'u1', type: 'user', text: USER_TEXT[0]! },
    { id: 'a1', type: 'applied', deltas: trimDeltas, historyMark: trimmed, undone: false },
    { id: 'u2', type: 'user', text: USER_TEXT[1]! },
    { id: 'p1', type: 'proposal', deltas: removeDeltas, status: 'open' },
    { id: 'u3', type: 'user', text: USER_TEXT[2]! },
    {
      id: 'q1',
      type: 'ask',
      about: 'which_clip',
      choices: [{ clipId: 'clip-hand' }, { clipId: 'clip-run' }, { clipId: 'removed-meanwhile' }, 'all'],
      status: 'open',
      message: USER_TEXT[2]!,
    },
    { id: 'n1', type: 'note', code: 'not_timeline_edit' },
  ];
}

function model(entries: AssistEntry[], view: HistoryView, over: Partial<AssistPanelModel> = {}): AssistPanelModel {
  const previewOpen = over.previewOpen ?? entries.some((e) => e.type === 'proposal' && e.status === 'open');
  return {
    entries,
    busy: false,
    previewOpen,
    comparing: false,
    historyOf: (entry) => entryHistory(entry, view),
    canUndo: (entry) => canUndoEntry(entry, view, { proposalOpen: previewOpen, canCreate: true }),
    send: noop,
    answer: noop,
    applyProposal: noop,
    dismissProposal: noop,
    setComparing: noop,
    undoEntry: noop,
    ...over,
  };
}

function render(copy: StudioComposeCopy, assist: AssistPanelModel, canCreate = true): string {
  return renderToStaticMarkup(<AssistPanel assist={assist} copy={copy} canCreate={canCreate} project={project} />);
}

/** Every sentence the panel may show for the fixture, built from the dictionary only. */
function allowedText(copy: StudioComposeCopy, entries: readonly AssistEntry[]): Set<string> {
  const allowed = new Set<string>(USER_TEXT);
  const visit = (value: unknown) => {
    if (typeof value === 'string') allowed.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(copy.assist);
  allowed.add(copy.chat.readOnly);
  for (const entry of entries) {
    if (entry.type === 'applied' || entry.type === 'proposal') entry.deltas.forEach((d) => allowed.add(deltaText(d, copy)));
    if (entry.type === 'ask') {
      allowed.add(askQuestion(entry.about, copy));
      for (const choice of entry.choices) {
        const label = askChoiceText(choice, project, copy);
        if (label) allowed.add(label);
      }
    }
    if (entry.type === 'note') allowed.add(noteText(entry.code, copy, entry.seconds));
    if (entry.type === 'proposal' && entry.status === 'stale') allowed.add(noteText('stale', copy));
  }
  return allowed;
}

describe('AssistPanel — empty', () => {
  it('shows the heading, the hint, three examples, the input and the cost line, all from the dictionary', () => {
    const ko = studioComposeKo.assist;
    const html = render(studioComposeKo, model([], { current: base, undo: [], redo: [] }));
    for (const marker of ['data-assist-panel', 'data-assist-log', 'data-assist-input', 'data-assist-send']) {
      expect(html).toContain(marker);
    }
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(esc(ko.heading));
    expect(html).toContain(esc(ko.emptyHint));
    expect(html).toContain(`placeholder="${esc(ko.placeholder)}"`);
    expect(html).toContain(`aria-label="${esc(ko.inputLabel)}"`);
    expect(html).toContain(esc(ko.costNote));
    expect(html.match(/data-assist-example/g)).toHaveLength(3);
    for (const example of Object.values(ko.examples)) expect(html).toContain(esc(example));
    expect(html).not.toContain('data-assist-entry');
    // Nothing typed yet: the send button waits.
    expect(tagWith(html, 'data-assist-send')).toContain('disabled');
    for (const text of textNodes(html)) expect(allowedText(studioComposeKo, []).has(text), text).toBe(true);
  });

  it('is read-only for viewers without create rights', () => {
    const html = render(studioComposeKo, model([], { current: base, undo: [], redo: [] }), false);
    expect(tagWith(html, 'data-assist-input')).toContain('disabled');
    expect(html).toContain(esc(studioComposeKo.chat.readOnly));
    expect(html).not.toContain('data-assist-example');
    expect(html).not.toContain(esc(studioComposeKo.assist.costNote));
  });
});

describe('AssistPanel — entries', () => {
  const entries = fixtureEntries();
  const view: HistoryView = { current: trimmed, undo: [base], redo: [] };

  it('renders each entry kind in order with its markers', () => {
    const html = render(studioComposeKo, model(entries, view));
    expect([...html.matchAll(/data-assist-entry="(\w+)"/g)].map((m) => m[1])).toEqual([
      'user',
      'applied',
      'user',
      'proposal',
      'user',
      'ask',
      'note',
    ]);
    expect(html).not.toContain(esc(studioComposeKo.assist.emptyHint));
    expect(html).not.toContain('data-assist-example');
  });

  it('words the proposal from the dictionary, total last, with Apply / Cancel / Show original', () => {
    const p = studioComposeKo.assist.proposal;
    const html = render(studioComposeKo, model(entries, view));
    const proposal = html.slice(html.indexOf('data-assist-proposal'));
    expect(tagWith(html, 'data-assist-proposal')).toContain('data-status="open"');
    expect(proposal).toContain(esc(p.title));
    const lines = removeDeltas.map((d) => esc(deltaText(d, studioComposeKo)));
    expect(lines[2]).toBe('전체 길이 20초 → 16초');
    const positions = lines.map((line) => proposal.indexOf(line));
    expect(positions.every((pos) => pos > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(tagWith(html, 'data-assist-apply')).not.toContain('disabled');
    expect(proposal).toContain(`data-assist-apply="true">${esc(p.apply)}<`);
    expect(proposal).toContain(`data-assist-dismiss="true">${esc(p.dismiss)}<`);
    expect(proposal).toContain(`data-assist-compare="true">${esc(p.compare)}<`);
    expect(tagWith(html, 'data-assist-compare')).toContain('aria-pressed="false"');
  });

  it("disables the applied entry's undo while a proposal is open", () => {
    const html = render(studioComposeKo, model(entries, view));
    expect(tagWith(html, 'data-assist-undo')).toContain('disabled');
    expect(html).toContain(`>${esc(studioComposeKo.assist.proposal.undo)}<`);
  });

  it('names answer chips by current cut position, drops vanished cuts and keeps "all"', () => {
    const ask = studioComposeKo.assist.ask;
    const html = render(studioComposeKo, model(entries, view));
    expect(html).toContain(esc(ask.whichClip));
    expect(html).toContain('data-assist-choice="0"');
    expect(html).toContain('>컷 2<');
    expect(html).toContain('>컷 3<');
    expect(html).not.toContain('data-assist-choice="2"');
    expect(html).toContain(`>${esc(ask.choiceAll)}<`);
    expect(html).toContain(esc(studioComposeKo.assist.notes.notTimelineEdit));
  });

  it('has no hard-coded sentence: every text node comes from the dictionary or the user (ko and en)', () => {
    for (const copy of [studioComposeKo, studioComposeEn]) {
      const html = render(copy, model(entries, view));
      const allowed = allowedText(copy, entries);
      for (const text of textNodes(html)) expect(allowed.has(text), text).toBe(true);
    }
    // English screen: no Korean outside what the user typed and the caption text from the timeline.
    const en = render(studioComposeEn, model(entries, view));
    const korean = textNodes(en).filter((t) => /[가-힣]/.test(t) && !USER_TEXT.includes(t) && !t.includes('지금 만나보세요'));
    expect(korean).toEqual([]);
  });
});

describe('AssistPanel — after apply, undo and cancel', () => {
  const entries: AssistEntry[] = [
    { id: 'u1', type: 'user', text: USER_TEXT[0]! },
    { id: 'a1', type: 'applied', deltas: trimDeltas, historyMark: trimmed, undone: false },
    { id: 'u2', type: 'user', text: USER_TEXT[1]! },
    { id: 'p1', type: 'proposal', deltas: removeDeltas, status: 'dismissed' },
    { id: 'p2', type: 'proposal', deltas: removeDeltas, status: 'applied', historyMark: later, undone: false },
    { id: 'p3', type: 'proposal', deltas: removeDeltas, status: 'stale' },
  ];

  it('enables undo only on the top of the history', () => {
    const view: HistoryView = { current: later, undo: [base, trimmed], redo: [] };
    const html = render(studioComposeKo, model(entries, view));
    const undoTags = [...html.matchAll(/<button[^>]*data-assist-undo[^>]*>/g)].map((m) => m[0]);
    expect(undoTags).toHaveLength(2);
    expect(undoTags[0]).toContain('disabled'); // the instant edit is buried under the applied proposal
    expect(undoTags[1]).not.toContain('disabled');
    const p = studioComposeKo.assist.proposal;
    expect(html).toContain(`>${esc(p.applied)}<`);
    expect(html).toContain(`>${esc(p.dismissed)}<`);
    expect(html).toContain(esc(studioComposeKo.assist.notes.stale));
    expect(html).not.toContain('data-assist-apply');
  });

  it('reads as undone once undone', () => {
    const view: HistoryView = { current: trimmed, undo: [base], redo: [later] };
    const html = render(studioComposeKo, model(entries, view));
    expect(html).toContain(`>${esc(studioComposeKo.assist.proposal.undone)}<`);
    // The instant edit is the top again.
    expect(tagWith(html, 'data-assist-undo')).not.toContain('disabled');
  });

  it('shows the busy line and holds the send button while reading', () => {
    const html = render(studioComposeKo, model([], { current: base, undo: [], redo: [] }, { busy: true }));
    expect(html).toContain(`>${esc(studioComposeKo.assist.busy)}<`);
    expect(tagWith(html, 'data-assist-send')).toContain('disabled');
  });
});

describe('AssistPreviewBar', () => {
  it('says the screen is a preview, from the dictionary', () => {
    const html = renderToStaticMarkup(<AssistPreviewBar text={studioComposeKo.assist.proposal.previewBar} />);
    expect(html).toContain('data-assist-preview-bar');
    expect(html).toContain('role="status"');
    expect(html).toContain(esc(studioComposeKo.assist.proposal.previewBar));
  });
});
