import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoomNoticeEmail, buildRoomNoticePush, type RoomNoticeLine } from '@/lib/brand-rooms/notices';
import { noticeEnv } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §10 — the founder's confirmed wording (2026-11-18), as built into the mail
 * and the push of each kind, in Korean and English. Every template below is copied from §10.2/§10.3 by
 * hand, not read from the dictionary: a change to messages/rooms-notices.ts that drifts from the
 * confirmed text fails here. `fill` only substitutes the placeholders the way the mail does.
 */
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const PROJECT = 'b0000000-0000-4000-8000-00000000000b';
const USER = 'c0000000-0000-4000-8000-00000000000c';

type Kind = 'new_version' | 'storyboard' | 'replies' | 'mention' | 'intake_received';
interface Row {
  subject: string;
  heading: string;
  body: string;
  button: string;
  pushTitle: string | null;
  pushBody: string | null;
}

/** §10.2 한국어, cell for cell. */
const KO: Record<Kind, Row> = {
  new_version: {
    subject: '[{project}] {title} 새 시안이 도착했어요',
    heading: '{title}의 새 버전이 올라왔습니다.',
    body: '야기 팀이 {version}번째 시안을 준비했어요. 확인하고 의견을 남겨주세요.',
    button: '시안 확인하기',
    pushTitle: '새 시안 도착',
    pushBody: '[{project}] {title}의 {version}번째 시안을 확인해 보세요.',
  },
  storyboard: {
    subject: '[{project}] 스토리보드가 공유되었습니다',
    heading: '{title} 스토리보드를 확인해 보세요.',
    body: '야기 팀이 작업 방향을 담은 스토리보드를 올렸습니다. 내용을 검토해 주세요.',
    button: '스토리보드 보기',
    pushTitle: '스토리보드 공유',
    pushBody: '[{project}] {title}의 스토리보드가 도착했습니다.',
  },
  replies: {
    subject: '[{project}] 읽지 않은 메시지가 {count}건 있어요',
    heading: '야기 팀의 메시지를 확인해 주세요.',
    body: '아직 확인하지 않은 의견과 답글이 {count}건 있습니다.',
    button: '메시지 확인하기',
    pushTitle: '새 메시지 {count}건',
    pushBody: '[{project}] 야기 팀이 보낸 메시지가 {count}건 있습니다.',
  },
  mention: {
    subject: '[{project}] {name}님이 불렀어요',
    heading: '{name}님이 불렀어요',
    body: '{name}님이 프로젝트 대화에서 불렀어요. 내용을 확인해 주세요.',
    button: '대화 바로가기',
    pushTitle: '나를 불렀어요',
    pushBody: '[{project}] {name}님이 불렀어요',
  },
  intake_received: {
    subject: '[{project}] 의뢰가 접수되었습니다',
    heading: '요청하신 내용이 잘 전달되었습니다.',
    body: '야기 팀이 보내주신 의뢰 내용을 확인하고 있습니다.',
    button: '내 의뢰 확인하기',
    pushTitle: null,
    pushBody: null,
  },
};

/** §10.3 English, cell for cell. */
const EN: Record<Kind, Row> = {
  new_version: {
    subject: 'New version of {title} for {project}',
    heading: 'A new version of {title} is ready.',
    body: 'The YAGI team has uploaded version {version}. Please review it and share your feedback.',
    button: 'Review Draft',
    pushTitle: 'New Draft Ready',
    pushBody: 'Check out version {version} of {title} in {project}.',
  },
  storyboard: {
    subject: 'Storyboard shared for {project}',
    heading: 'Your storyboard for {title} is ready.',
    body: 'The YAGI team has shared the storyboard outlining the project direction. Please take a look.',
    button: 'View Storyboard',
    pushTitle: 'Storyboard Shared',
    pushBody: 'The storyboard for {title} in {project} is now available.',
  },
  replies: {
    subject: '{count} unread messages in {project}',
    heading: 'You have new messages from the YAGI team.',
    body: 'There are {count} unread replies and messages.',
    button: 'View Messages',
    pushTitle: '{count} New Messages',
    pushBody: 'You have {count} new messages from the YAGI team in {project}.',
  },
  mention: {
    subject: '{name} mentioned you in {project}',
    heading: '{name} mentioned you',
    body: '{name} mentioned you in the project conversation. Please check the message.',
    button: 'Go to Chat',
    pushTitle: 'You were mentioned',
    pushBody: '[{project}] {name} mentioned you',
  },
  intake_received: {
    subject: 'Request received for {project}',
    heading: 'Your request has been submitted.',
    body: 'The YAGI team is reviewing your requirements.',
    button: 'View Request',
    pushTitle: null,
    pushBody: null,
  },
};

/** §10.2 / §10.3: the footer sentence and its link. */
const FOOTER = {
  ko: { text: '이 메일은 프로젝트 진행 알림이며, 알림 설정에서 수신 여부를 변경할 수 있습니다.', stop: '수신 거부' },
  en: { text: 'This is a project notification. You can manage your notification settings in the workspace.', stop: 'Unsubscribe' },
};

/** Sentences §10 took out of the draft (§9 review): none of them may come back. */
const REMOVED = ['곧 안내해 드릴게요', '원활한 프로젝트 진행', '정상적으로', '성공적으로', '호출', 'We will get back to you soon', 'successfully', 'keep the project moving'];

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));

const VALUES = { project: 'Spring launch', title: 'Hero film', version: 2, name: 'Mina', count: 3 };

function linesFor(kind: Kind): RoomNoticeLine[] {
  switch (kind) {
    case 'replies':
      return [
        { kind: 'team_message', name: 'YAGI team', excerpt: 'First cut is up.' },
        { kind: 'team_reply', name: 'YAGI team · Jisoo', title: 'Hero film', excerpt: 'Moved the logo.' },
        { kind: 'team_message', name: 'YAGI team', excerpt: 'Sound is next.' },
      ];
    case 'mention':
      return [{ kind: 'mention', name: 'Mina', excerpt: 'Can you look at cut 3?' }];
    case 'intake_received':
      return [{ kind: 'intake_received' }];
    default:
      return [{ kind, title: 'Hero film', version: 2, name: 'YAGI team' }];
  }
}

const mailOf = (locale: 'ko' | 'en', kind: Kind, projectId: string | null = PROJECT) =>
  buildRoomNoticeEmail({ locale, recipientId: USER, organizationId: ORG, projectId, projectTitle: 'Spring launch', lines: linesFor(kind) });
const pushOf = (locale: 'ko' | 'en', kind: Kind, projectId: string | null = PROJECT) =>
  buildRoomNoticePush({ locale, organizationId: ORG, projectId, projectTitle: 'Spring launch', lines: linesFor(kind) });

beforeEach(() => noticeEnv());
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ['ko', KO],
  ['en', EN],
] as const)('the confirmed %s wording (§10)', (locale, table) => {
  it.each(Object.keys(table) as Kind[])('%s: subject, heading, body and button exactly as confirmed', (kind) => {
    const row = table[kind];
    const mail = mailOf(locale, kind);
    expect(mail.subject).toBe(fill(row.subject, VALUES));
    // The text twin starts with the heading, then the body; the HTML carries both as written.
    const lines = mail.text.split('\n');
    expect(lines[0]).toBe(fill(row.heading, VALUES));
    expect(lines[2]).toBe(fill(row.body, VALUES));
    expect(mail.html).toContain(`>${fill(row.heading, VALUES)}</h1>`);
    expect(mail.html).toContain(`>${fill(row.body, VALUES)}</p>`);
    expect(mail.text).toContain(`${row.button}: ${mail.buttonUrl}`);
    expect(mail.html).toContain(`>${row.button}</a>`);
  });

  it.each(Object.keys(table) as Kind[])('%s: the push title and body exactly as confirmed (none for the receipt)', (kind) => {
    const row = table[kind];
    const push = pushOf(locale, kind);
    if (row.pushTitle === null) {
      expect(push).toBeNull();
      return;
    }
    expect(push).toMatchObject({ title: fill(row.pushTitle, VALUES), body: fill(row.pushBody!, VALUES), lang: locale });
  });

  it('ends every mail with the confirmed footer sentence, the unsubscribe link and the company line', () => {
    for (const kind of Object.keys(table) as Kind[]) {
      const mail = mailOf(locale, kind);
      expect(mail.text, kind).toContain(`${FOOTER[locale].text} ${FOOTER[locale].stop}: ${mail.unsubscribeUrl}`);
      expect(mail.html, kind).toContain(FOOTER[locale].text);
      expect(mail.html, kind).toContain(`>${FOOTER[locale].stop}</a>`);
      expect(mail.unsubscribeUrl).toMatch(/^https:\/\/twings\.app\/api\/notify\/unsubscribe\?t=/);
      // The company line is the last line of the text twin.
      expect(mail.text.split('\n').at(-1)).toMatch(locale === 'ko' ? /야기워크숍/ : /YAGI WORKSHOP/);
    }
  });

  it('carries none of the sentences §10 removed, no internal tool names and no invitation to reply', () => {
    for (const kind of Object.keys(table) as Kind[]) {
      for (const general of [false, true]) {
        if (general && (kind === 'new_version' || kind === 'storyboard' || kind === 'intake_received')) continue;
        const mail = mailOf(locale, kind, general ? null : PROJECT);
        const push = pushOf(locale, kind, general ? null : PROJECT);
        const all = [mail.subject, mail.html, mail.text, push?.title ?? '', push?.body ?? ''].join('\n');
        for (const banned of [...REMOVED, 'Slack', '슬랙', 'webhook', 'Webhook']) expect(all, `${kind} ${banned}`).not.toContain(banned);
        expect(mail.text, kind).not.toMatch(/reply to this|이 메일에 답/i);
      }
    }
  });
});

describe('what goes in the placeholders (§10.1)', () => {
  it('names the general conversation by its channel name and opens the inbox on it', () => {
    for (const [locale, name] of [
      ['ko', '일반 문의'],
      ['en', 'General'],
    ] as const) {
      const mail = mailOf(locale, 'replies', null);
      expect(mail.subject).toBe(fill((locale === 'ko' ? KO : EN).replies.subject, { ...VALUES, project: name }));
      expect(mail.buttonUrl).toBe(`https://brand.twings.app/brand/rooms?organizationId=${ORG}&channel=general`);
      expect(mail.subject + mail.text).not.toContain('Spring launch');
      const push = pushOf(locale, 'replies', null)!;
      expect(push.body).toBe(fill((locale === 'ko' ? KO : EN).replies.pushBody!, { ...VALUES, project: name }));
      expect(push).toMatchObject({ url: `/brand/rooms?organizationId=${ORG}&channel=general`, tag: ORG });
    }
  });

  it('opens a project notice in its room on the brand host, with the project as push tag', () => {
    const mail = mailOf('ko', 'new_version');
    expect(mail.buttonUrl).toBe(`https://brand.twings.app/brand/rooms/${PROJECT}?organizationId=${ORG}`);
    expect(pushOf('ko', 'new_version')).toMatchObject({ url: `/brand/rooms/${PROJECT}?organizationId=${ORG}`, tag: PROJECT, topic: PROJECT.replace(/-/g, '') });
  });

  it('falls back to the project title and version 1 when the event line has neither', () => {
    const mail = buildRoomNoticeEmail({ locale: 'en', recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [{ kind: 'new_version' }] });
    expect(mail.subject).toBe('New version of Spring launch for Spring launch');
    expect(mail.text).toContain('The YAGI team has uploaded version 1. Please review it and share your feedback.');
    const push = buildRoomNoticePush({ locale: 'ko', organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [{ kind: 'storyboard', version: 0 }] })!;
    expect(push.body).toBe('[Spring launch] Spring launch의 스토리보드가 도착했습니다.');
  });

  it('counts every row of the bundle, quotes at most five with text, oldest first, and has no "and N more" line', () => {
    const lines: RoomNoticeLine[] = [
      { kind: 'team_message', name: 'YAGI team', excerpt: '' }, // a file-only message: counted, not quoted
      ...Array.from({ length: 6 }, (_, i): RoomNoticeLine => ({ kind: 'team_message', name: 'YAGI team · Jisoo', excerpt: `Line ${i + 1}` })),
      { kind: 'team_reply', name: 'YAGI team', title: 'Hero film', excerpt: null }, // a reply whose note is not readable
    ];
    const mail = buildRoomNoticeEmail({ locale: 'ko', recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines });
    expect(mail.subject).toBe('[Spring launch] 읽지 않은 메시지가 8건 있어요');
    expect(mail.text).toContain('아직 확인하지 않은 의견과 답글이 8건 있습니다.');
    const quotes = mail.text.split('\n').filter((l) => l.startsWith('YAGI team'));
    expect(quotes).toEqual(['YAGI team · Jisoo: Line 1', 'YAGI team · Jisoo: Line 2', 'YAGI team · Jisoo: Line 3', 'YAGI team · Jisoo: Line 4', 'YAGI team · Jisoo: Line 5']);
    expect(mail.text).not.toContain('Line 6');
    expect(mail.text).not.toMatch(/외 \d+건|and \d+ more/);
    // Each quote is a row under the body in the HTML too.
    expect(mail.html.match(/<tr>/g)).toHaveLength(5);
  });

  it('quotes the mention’s own line under the body, and nothing for a mention without text', () => {
    const mail = mailOf('ko', 'mention');
    expect(mail.text).toContain('Mina: Can you look at cut 3?');
    expect(mail.subject).toBe('[Spring launch] Mina님이 불렀어요');
    const bare = buildRoomNoticeEmail({ locale: 'ko', recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [{ kind: 'mention', name: 'Mina', excerpt: '' }] });
    expect(bare.html).not.toContain('<tr>');
  });

  it('quotes nothing in a new draft, storyboard or receipt mail', () => {
    for (const kind of ['new_version', 'storyboard', 'intake_received'] as const) expect(mailOf('en', kind).html, kind).not.toContain('<tr>');
  });

  it('pushes the team’s lines with how many were pushed together', () => {
    const one = buildRoomNoticePush({ locale: 'en', organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [{ kind: 'team_reply', excerpt: 'x' }] })!;
    expect(one).toMatchObject({ title: '1 New Message', body: 'You have 1 new message from the YAGI team in Spring launch.' });
  });
});

/**
 * docs §10.3, the line under the table: with exactly one row the English replies strings use the
 * singular form, the mechanical inflection of the confirmed sentences. Korean keeps its one form.
 */
describe('one row in the bundle', () => {
  const EN_ONE = {
    subject: '1 unread message in {project}',
    body: 'There is 1 unread reply or message.',
    pushTitle: '1 New Message',
    pushBody: 'You have 1 new message from the YAGI team in {project}.',
  };
  const bundle = (count: number): RoomNoticeLine[] => Array.from({ length: count }, (_, i) => ({ kind: 'team_message', name: 'YAGI team', excerpt: `Line ${i + 1}` }));
  const build = (locale: 'ko' | 'en', count: number) => ({
    mail: buildRoomNoticeEmail({ locale, recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: bundle(count) }),
    push: buildRoomNoticePush({ locale, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: bundle(count) })!,
  });

  it('uses the English singular for exactly one, and the confirmed plural for two', () => {
    const one = build('en', 1);
    expect(one.mail.subject).toBe(fill(EN_ONE.subject, VALUES));
    expect(one.mail.text.split('\n')[2]).toBe(EN_ONE.body);
    expect(one.push).toMatchObject({ title: EN_ONE.pushTitle, body: fill(EN_ONE.pushBody, VALUES) });
    // The heading and the button have no count: the same in both.
    expect(one.mail.text.split('\n')[0]).toBe(EN.replies.heading);
    expect(one.mail.text).toContain(`${EN.replies.button}: `);
    const two = build('en', 2);
    const values = { ...VALUES, count: 2 };
    expect(two.mail.subject).toBe(fill(EN.replies.subject, values));
    expect(two.mail.text.split('\n')[2]).toBe(fill(EN.replies.body, values));
    expect(two.push).toMatchObject({ title: fill(EN.replies.pushTitle!, values), body: fill(EN.replies.pushBody!, values) });
  });

  it('keeps Korean as confirmed for one and for two', () => {
    for (const count of [1, 2]) {
      const { mail, push } = build('ko', count);
      const values = { ...VALUES, count };
      expect(mail.subject).toBe(fill(KO.replies.subject, values));
      expect(mail.text.split('\n')[2]).toBe(fill(KO.replies.body, values));
      expect(push).toMatchObject({ title: fill(KO.replies.pushTitle!, values), body: fill(KO.replies.pushBody!, values) });
    }
  });
});

/** A mention's `{name}` is the person's plain name; the quote line under it keeps the §10.1 author label. */
describe('who a mention names', () => {
  const mention = (locale: 'ko' | 'en', line: RoomNoticeLine) => ({
    mail: buildRoomNoticeEmail({ locale, recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [line] }),
    push: buildRoomNoticePush({ locale, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines: [line] })!,
  });

  it('names a team member by name and quotes them as "YAGI team · name"', () => {
    const line: RoomNoticeLine = { kind: 'mention', name: 'YAGI team · Jisoo', person: 'Jisoo', excerpt: 'Please check cut 3.' };
    const ko = mention('ko', { ...line, name: '야기 팀 · Jisoo' });
    expect(ko.mail.subject).toBe(fill(KO.mention.subject, { ...VALUES, name: 'Jisoo' }));
    expect(ko.mail.text).toContain(fill(KO.mention.body, { ...VALUES, name: 'Jisoo' }));
    expect(ko.mail.text).toContain('야기 팀 · Jisoo: Please check cut 3.');
    expect(ko.push.body).toBe('[Spring launch] Jisoo님이 불렀어요');
    const en = mention('en', line);
    expect(en.mail.subject).toBe('Jisoo mentioned you in Spring launch');
    expect(en.mail.text).toContain('YAGI team · Jisoo: Please check cut 3.');
    expect(en.push.body).toBe('[Spring launch] Jisoo mentioned you');
  });
});
