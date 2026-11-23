import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import {
  EditSheetCard,
  buildSheetDirectorSpec,
  foldPendingForOrder,
  pendingFoldNotice,
  readSheetTurnAnswer,
  sheetNoticeText,
  sheetRefusalNotice,
  type EditSheetCopy
} from '@/components/twings/edit-sheet-card';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';
import { chipsFromSheet, emptyPersonalSheet, emptyPersonalSheetState } from '@/lib/template-director/sheet';
import type { PersonalEditSheet, PersonalSheetState } from '@/lib/template-director/schema';

/** docs/PERSONAL-STUDIO.md §2.3, §3.1 — the customer edit sheet card (flag `TWINGS_PERSONAL_EDIT_SHEET`). */

const filled: PersonalEditSheet = {
  change: [
    { text: '블랙 실크 원피스', slot: 'outfit', ref: 'look_ref', was: ['크림 트위드 자켓'] },
    { text: '카메라를 보며 웃기', slot: 'shot_action', shots: { from: 2, to: 3 } },
    { text: '마지막 컷 손 인사', slot: 'shot_action', shots: { from: 4, to: 4 } }
  ],
  keep: ['내 머리 길이'],
  exclude: ['자막']
};

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('EditSheetCard markup', () => {
  it('shows change, keep and exclude blocks in that order', () => {
    const html = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={filled} />);
    expect(html).toContain('data-edit-sheet');
    expect(count(html, 'data-edit-sheet-block=')).toBe(3);
    const change = html.indexOf('data-edit-sheet-block="change"');
    const keep = html.indexOf('data-edit-sheet-block="keep"');
    const exclude = html.indexOf('data-edit-sheet-block="exclude"');
    expect(change).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(change);
    expect(exclude).toBeGreaterThan(keep);
    expect(html.indexOf(ko.editSheet.changeHeading)).toBeLessThan(html.indexOf(ko.editSheet.keepHeading));
    expect(count(html, 'data-edit-sheet-line=')).toBe(5);
  });

  it('offers revert only on a change line with an earlier value, and remove on every line', () => {
    const html = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={filled} />);
    expect(count(html, 'data-edit-sheet-revert=')).toBe(1);
    expect(html).toContain('data-edit-sheet-revert="0"');
    expect(count(html, 'data-edit-sheet-remove=')).toBe(5);
    expect(html).toContain('data-edit-sheet-remove="keep-0"');
    expect(html).toContain('data-edit-sheet-remove="exclude-0"');
    expect(html).toContain(`aria-label="${ko.editSheet.slots.outfit}: 블랙 실크 원피스 되돌리기"`);
    expect(html).toContain(`aria-label="자막 빼기"`);
  });

  it('marks the attached photo and the shot range, with slot names from the dictionary', () => {
    const html = renderToStaticMarkup(<EditSheetCard copy={en.editSheet} sheet={filled} />);
    expect(count(html, 'data-edit-sheet-photo')).toBe(1);
    expect(html).toContain(en.editSheet.photoAttached);
    expect(html).toContain('Shots 2–3');
    expect(html).toContain('Shot 4');
    expect(html).toContain(`>${en.editSheet.slots.outfit}<`);
    expect(html).toContain(`>${en.editSheet.slots.shot_action}<`);
    // The server's Korean chip label never reaches the English card.
    expect(html).not.toContain('의상');
    expect(html).not.toContain('연출');
  });

  it('renders the clarifying question with its options and says answering is optional', () => {
    const html = renderToStaticMarkup(
      <EditSheetCard
        copy={ko.editSheet}
        sheet={filled}
        question={{ point: '의상 범위', text: '모든 컷에서 바꿀까요?', options: ['모든 컷', '2~3컷만', '첫 컷만', '넷째는 버려짐'] }}
      />
    );
    expect(html).toContain('data-edit-sheet-question');
    expect(html).toContain('모든 컷에서 바꿀까요?');
    expect(count(html, 'data-edit-sheet-option=')).toBe(3);
    expect(html).toContain('>2~3컷만</button>');
    expect(html).not.toContain('넷째는 버려짐');
    expect(html).toContain(ko.editSheet.questionOptional);
  });

  it('shows one inviting line when the sheet is empty', () => {
    const html = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={emptyPersonalSheet()} />);
    expect(html).toContain('data-edit-sheet-empty');
    expect(html).toContain(ko.editSheet.empty);
    expect(html).not.toContain('data-edit-sheet-block');
  });

  it('tags the line that holds typed text not sent yet, and has a polite live line', () => {
    const html = renderToStaticMarkup(
      <EditSheetCard copy={ko.editSheet} sheet={filled} pendingIndex={2} notice="담았어요" />
    );
    expect(count(html, 'data-edit-sheet-pending')).toBe(1);
    expect(html).toContain(ko.editSheet.pendingTag);
    expect(html).toMatch(/role="status" aria-live="polite" data-edit-sheet-status[^>]*>[\s\S]*담았어요/);
    // The pending line's text belongs to the input, so it has no revert.
    expect(html).not.toContain('data-edit-sheet-revert="2"');
  });
});

/** Every leaf replaced by a token that keeps its placeholders, so a hard-coded string stands out. */
function sentinelCopy(copy: EditSheetCopy): EditSheetCopy {
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const holes = value.match(/\{\w+\}/g) ?? [];
      return `@${path}@${holes.join('')}`;
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, `${path}.${k}`)]));
  };
  return walk(copy, 'es') as EditSheetCopy;
}

describe('edit sheet copy', () => {
  it('draws no words of its own: every visible string and accessible name comes from the dictionary', () => {
    const copy = sentinelCopy(en.editSheet);
    const html = renderToStaticMarkup(
      <EditSheetCard
        copy={copy}
        sheet={filled}
        pendingIndex={2}
        question={{ point: 'p', text: 'Q?', options: ['O1'] }}
        notice={sheetNoticeText({ kind: 'copy', key: 'updated' }, copy)}
        foldNotice={pendingFoldNotice({ status: 'full' }, copy)}
      />
    );
    const data = ['블랙 실크 원피스', '카메라를 보며 웃기', '마지막 컷 손 인사', '내 머리 길이', '자막', 'Q?', 'O1'];
    const strip = (text: string) =>
      data.reduce((rest, d) => rest.split(d).join(''), text.replace(/@es\.[\w.]+@/g, ''));
    const visible = strip(html.replace(/<[^>]+>/g, ' '));
    expect(visible.replace(/[\s×·:\d–~]/g, '')).toBe('');
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => strip(m[1]!));
    for (const label of labels) expect(label.replace(/[\s×·:\d–~]/g, '')).toBe('');
  });

  it('never names models, providers, prompts or engines', () => {
    const banned = /gemini|seedance|seedream|모델|프롬프트|prompt|model|engine|엔진/i;
    const leaves = (value: unknown): string[] =>
      typeof value === 'string' ? [value] : Object.values(value as Record<string, unknown>).flatMap(leaves);
    for (const value of [...leaves(en.editSheet), ...leaves(ko.editSheet)]) expect(value).not.toMatch(banned);
  });

  it('the English sheet path of the panel shows no Korean inside the card', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel locale="en" editSheet={en.editSheet} initialExpanded={true} />
    );
    const start = html.indexOf('data-edit-sheet');
    expect(start).toBeGreaterThan(-1);
    const card = html.slice(html.lastIndexOf('<section', start), html.indexOf('</section>', html.indexOf('data-edit-sheet-status')));
    expect(card).not.toMatch(/[가-힣]/);
  });
});

describe('the panel in sheet mode', () => {
  it('shows the card instead of the chips row', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel locale="ko" editSheet={ko.editSheet} initialExpanded={true} />
    );
    expect(html).toContain('data-edit-sheet');
    expect(html).toContain(ko.editSheet.empty);
    expect(html).not.toContain('data-director-summary-chips');
  });

  it('hides an empty card while the panel is collapsed', () => {
    const html = renderToStaticMarkup(<TemplateDirectorPanel locale="ko" editSheet={ko.editSheet} />);
    expect(html).not.toContain('data-edit-sheet');
    expect(html).toContain('data-director-toggle');
  });
});

describe('buildSheetDirectorSpec (what the order carries)', () => {
  const base = { audioMode: 'ambient' as const, bgmMood: null, slotOverrides: [] };

  it('carries the sheet without history, chips derived from it and the change texts as the note', () => {
    const { spec, fold } = buildSheetDirectorSpec({ ...base, sheet: filled, pendingNote: '' });
    expect(fold.status).toBe('none');
    expect(spec).not.toBeNull();
    expect(spec!.sheet!.change[0]).toEqual({ text: '블랙 실크 원피스', slot: 'outfit', ref: 'look_ref' });
    expect(spec!.sheet!.change.some((l) => 'was' in l)).toBe(false);
    expect(spec!.sheet!.keep).toEqual(['내 머리 길이']);
    expect(spec!.sheet!.exclude).toEqual(['자막']);
    expect(spec!.summaryChips).toEqual(chipsFromSheet(filled));
    expect(spec!.userMessage).toBe('블랙 실크 원피스\n카메라를 보며 웃기\n마지막 컷 손 인사');
    expect(spec!.structuredIntent).toBeNull();
    expect(spec!.audioMode).toBe('ambient');
  });

  it('folds typed text that was not sent, so the order never drops it', () => {
    const { spec, fold } = buildSheetDirectorSpec({ ...base, sheet: filled, pendingNote: '  배경을 바다로  ' });
    expect(fold.status).toBe('folded');
    expect(fold.pendingIndex).toBe(3);
    expect(fold.sheet.change[3]).toEqual({ text: '배경을 바다로', slot: 'shot_action' });
    expect(spec!.sheet!.change).toHaveLength(4);
    expect(spec!.userMessage!.split('\n').at(-1)).toBe('배경을 바다로');
    expect(spec!.summaryChips).toHaveLength(4);
  });

  it('reports a full change block and leaves the typed text out of the order', () => {
    // Six lines and no whole-video action line to append to (the only action is limited to shot 1).
    const six: PersonalEditSheet = {
      change: [
        ...(['outfit', 'makeup', 'hair', 'prop', 'lighting_mood'] as const).map((slot, i) => ({ text: `줄 ${i + 1}`, slot })),
        { text: '줄 6', slot: 'shot_action', shots: { from: 1, to: 1 } }
      ],
      keep: [],
      exclude: []
    };
    const { spec, fold } = buildSheetDirectorSpec({ ...base, sheet: six, pendingNote: '하나 더' });
    expect(fold.status).toBe('full');
    expect(fold.pendingIndex).toBeNull();
    expect(spec!.sheet!.change).toHaveLength(6);
    expect(spec!.userMessage).not.toContain('하나 더');
    expect(pendingFoldNotice(fold, ko.editSheet)).toBe(ko.editSheet.full.replace('{max}', '6'));
  });

  it('joins a full block onto its last whole-video action line instead', () => {
    const six: PersonalEditSheet = {
      change: [
        ...(['outfit', 'makeup', 'hair', 'prop', 'lighting_mood'] as const).map((slot, i) => ({ text: `줄 ${i + 1}`, slot })),
        { text: '천천히 걷기', slot: 'shot_action' }
      ],
      keep: [],
      exclude: []
    };
    const fold = foldPendingForOrder(six, '손 흔들기');
    expect(fold.status).toBe('folded');
    expect(fold.pendingIndex).toBe(5);
    expect(fold.sheet.change[5]!.text).toBe('천천히 걷기 · 손 흔들기');
  });

  it('does not repeat a request already listed, and refuses text the guard blocks', () => {
    expect(foldPendingForOrder(filled, '').status).toBe('none');
    const listed: PersonalEditSheet = { change: [{ text: '손 흔들기', slot: 'shot_action' }], keep: [], exclude: [] };
    expect(foldPendingForOrder(listed, '손 흔들기')).toMatchObject({ status: 'present', pendingIndex: null });
    const blocked = foldPendingForOrder(filled, '연예인 얼굴로 바꿔줘');
    expect(blocked.status).toBe('blocked');
    expect(blocked.sheet).toBe(filled);
    expect(pendingFoldNotice(blocked, en.editSheet)).toBe(en.editSheet.refusedIdentity);
  });

  it('is null when nothing is asked for', () => {
    expect(buildSheetDirectorSpec({ ...base, sheet: emptyPersonalSheet(), pendingNote: '' }).spec).toBeNull();
    const withPhoto = buildSheetDirectorSpec({ ...base, sheet: emptyPersonalSheet(), pendingNote: '', slotOverrides: ['look_ref'] });
    expect(withPhoto.spec).toMatchObject({ slotOverrides: ['look_ref'], summaryChips: [], userMessage: null });
    expect(withPhoto.spec!.sheet).toBeUndefined();
    const withBgm = buildSheetDirectorSpec({ sheet: emptyPersonalSheet(), pendingNote: '', audioMode: 'bgm', bgmMood: 'cinematic', slotOverrides: [] });
    expect(withBgm.spec).toMatchObject({ audioMode: 'bgm', bgmMood: 'cinematic' });
  });
});

describe('readSheetTurnAnswer (refusals, 429 and failures)', () => {
  const prior: PersonalSheetState = { sheet: filled, turns: [], question: null, asked: false };
  const okTurn = (turn: Record<string, unknown>) => ({ ok: true, model: 'heuristic', turn });
  const nextSheet: PersonalEditSheet = { change: [{ text: '빨간 립', slot: 'makeup' }], keep: [], exclude: [] };

  it('leaves the sheet unchanged and says "try again shortly" on 429', () => {
    const out = readSheetTurnAnswer({ prior, message: 'x', status: 429, payload: { ok: false, code: 'rate_limited' }, replyReadable: true });
    expect(out.state).toBe(prior);
    expect(out.accepted).toBe(false);
    expect(out.notice).toEqual({ kind: 'copy', key: 'rateLimited' });
  });

  it('leaves the sheet unchanged with a generic retry on any other failure', () => {
    for (const [status, payload] of [
      [500, null],
      [503, { ok: false, code: 'unavailable' }],
      [200, { ok: false }],
      [200, okTurn({ approved: true, refusal: 'none', replyKo: '반영', summaryChips: [] })],
      [200, 'not json']
    ] as const) {
      const out = readSheetTurnAnswer({ prior, message: 'x', status, payload, replyReadable: true });
      expect(out.state).toBe(prior);
      expect(out.notice).toEqual({ kind: 'copy', key: 'retry' });
    }
  });

  it('maps every refusal code to dictionary copy, never the server sentence', () => {
    expect(sheetRefusalNotice('identity')).toBe('refusedIdentity');
    expect(sheetRefusalNotice('unsafe')).toBe('refusedUnsafe');
    expect(sheetRefusalNotice('unsupported')).toBe('refusedUnsupported');
    expect(sheetRefusalNotice('too_large')).toBe('refusedTooLarge');
    expect(sheetRefusalNotice('none')).toBe('refusedUnsupported');
    expect(sheetRefusalNotice('constructor')).toBe('refusedUnsupported');
    const out = readSheetTurnAnswer({
      prior,
      message: '연예인 얼굴로 바꿔줘',
      status: 200,
      payload: okTurn({ approved: false, refusal: 'identity', replyKo: '본인 얼굴만…', summaryChips: [], sheet: filled, question: null, asked: false, changed: false }),
      replyReadable: true
    });
    expect(out.accepted).toBe(false);
    expect(out.notice).toEqual({ kind: 'copy', key: 'refusedIdentity' });
    expect(out.state.sheet).toEqual(filled);
    expect(sheetNoticeText(out.notice, en.editSheet)).toBe(en.editSheet.refusedIdentity);
  });

  it('takes the new sheet, question and turns from an accepted answer', () => {
    const answer = okTurn({
      approved: true,
      refusal: 'none',
      replyKo: '메이크업을 빨간 립으로 바꿨어요.',
      summaryChips: chipsFromSheet(nextSheet),
      sheet: nextSheet,
      question: { point: '립', text: '매트로 할까요?', options: ['매트', '글로시'] },
      asked: true,
      changed: true
    });
    const en1 = readSheetTurnAnswer({ prior, message: '립 빨갛게', status: 200, payload: answer, replyReadable: false });
    expect(en1.accepted).toBe(true);
    expect(en1.state.sheet).toEqual(nextSheet);
    expect(en1.state.question).toEqual({ point: '립', text: '매트로 할까요?', options: ['매트', '글로시'] });
    expect(en1.state.asked).toBe(true);
    expect(en1.state.turns).toEqual([
      { role: 'customer', text: '립 빨갛게' },
      { role: 'studio', text: '메이크업을 빨간 립으로 바꿨어요.' }
    ]);
    expect(en1.notice).toEqual({ kind: 'copy', key: 'updated' });
    const ko1 = readSheetTurnAnswer({ prior, message: '립 빨갛게', status: 200, payload: answer, replyReadable: true });
    expect(ko1.notice).toEqual({ kind: 'reply', text: '메이크업을 빨간 립으로 바꿨어요.' });
    expect(sheetNoticeText(ko1.notice, ko.editSheet)).toBe('메이크업을 빨간 립으로 바꿨어요.');
  });

  it('says nothing changed, unless the studio asked a question instead', () => {
    const same = okTurn({ approved: true, refusal: 'none', replyKo: '', summaryChips: [], sheet: filled, question: null, asked: false, changed: false });
    expect(readSheetTurnAnswer({ prior, message: 'x', status: 200, payload: same, replyReadable: true }).notice).toEqual({ kind: 'copy', key: 'unchanged' });
    const asked = okTurn({ approved: true, refusal: 'none', replyKo: '', summaryChips: [], sheet: filled, question: { point: 'p', text: '어느 쪽?', options: [] }, asked: true, changed: false });
    expect(readSheetTurnAnswer({ prior, message: 'x', status: 200, payload: asked, replyReadable: false }).notice).toBeNull();
  });

  it('starts from an empty state', () => {
    expect(emptyPersonalSheetState()).toEqual({ sheet: { change: [], keep: [], exclude: [] }, turns: [], question: null, asked: false });
  });
});
