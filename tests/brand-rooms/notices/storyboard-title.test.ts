import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoomNoticeEmail, buildRoomNoticePush, storyboardNoticeTitle, type RoomNoticeLine } from '@/lib/brand-rooms/notices';
import { noticeEnv } from './helpers';

/**
 * The storyboard notice strings already name the kind ("{title} 스토리보드를 확인해 보세요.", "Your storyboard
 * for {title} is ready."), so a board titled "… 스토리보드" / "… Storyboard" read the word twice. The wording
 * stays as confirmed (docs/BRAND-ROOMS-FEEDBACK.md §10); the title loses one trailing type word before it goes
 * in. A draft's notice ("{title} 새 시안이 …") does not put the type word right after the title the same way,
 * so its titles go in untouched.
 */
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const PROJECT = 'b0000000-0000-4000-8000-00000000000b';
const USER = 'c0000000-0000-4000-8000-00000000000c';

beforeEach(() => noticeEnv());
afterEach(() => vi.unstubAllEnvs());

const board = (title: string): RoomNoticeLine[] => [{ kind: 'storyboard', title, version: 1, name: 'YAGI team' }];
const mail = (locale: 'ko' | 'en', lines: RoomNoticeLine[]) =>
  buildRoomNoticeEmail({ locale, recipientId: USER, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines });
const push = (locale: 'ko' | 'en', lines: RoomNoticeLine[]) => buildRoomNoticePush({ locale, organizationId: ORG, projectId: PROJECT, projectTitle: 'Spring launch', lines })!;

describe('storyboardNoticeTitle', () => {
  it('drops one trailing type word, in either language and any case, with the separator left dangling', () => {
    expect(storyboardNoticeTitle('가을 캠페인 스토리보드')).toBe('가을 캠페인');
    expect(storyboardNoticeTitle('가을캠페인스토리보드')).toBe('가을캠페인');
    expect(storyboardNoticeTitle('가을 캠페인 - 스토리보드')).toBe('가을 캠페인');
    expect(storyboardNoticeTitle('가을 캠페인 · 스토리보드 ')).toBe('가을 캠페인');
    expect(storyboardNoticeTitle('Autumn Storyboard')).toBe('Autumn');
    expect(storyboardNoticeTitle('Autumn launch: storyboard')).toBe('Autumn launch');
    expect(storyboardNoticeTitle('Autumn – STORYBOARD')).toBe('Autumn');
    expect(storyboardNoticeTitle('가을 Storyboard')).toBe('가을');
    // Only one: "스토리보드 스토리보드" keeps the first.
    expect(storyboardNoticeTitle('가을 스토리보드 스토리보드')).toBe('가을 스토리보드');
  });

  it('keeps a title that is only the word, and the word anywhere but the end', () => {
    expect(storyboardNoticeTitle('스토리보드')).toBe('스토리보드');
    expect(storyboardNoticeTitle('Storyboard')).toBe('Storyboard');
    expect(storyboardNoticeTitle(' - storyboard')).toBe('- storyboard');
    expect(storyboardNoticeTitle('스토리보드 초안 v2')).toBe('스토리보드 초안 v2');
    expect(storyboardNoticeTitle('Storyboard for the autumn film')).toBe('Storyboard for the autumn film');
    expect(storyboardNoticeTitle('가을 스토리보드 2차')).toBe('가을 스토리보드 2차');
    // Part of another English word is not the word.
    expect(storyboardNoticeTitle('Mystoryboard')).toBe('Mystoryboard');
  });
});

describe('storyboard notices', () => {
  it('reads the word once in the Korean mail and push', () => {
    const m = mail('ko', board('가을 캠페인 스토리보드'));
    expect(m.subject).toBe('[Spring launch] 스토리보드가 공유되었습니다');
    expect(m.text.split('\n')[0]).toBe('가을 캠페인 스토리보드를 확인해 보세요.');
    expect(m.html).toContain('>가을 캠페인 스토리보드를 확인해 보세요.</h1>');
    expect(m.text).not.toContain('스토리보드 스토리보드');
    const p = push('ko', board('가을 캠페인 스토리보드'));
    expect(p).toMatchObject({ title: '스토리보드 공유', body: '[Spring launch] 가을 캠페인의 스토리보드가 도착했습니다.' });
  });

  it('reads the word once in the English mail and push', () => {
    const m = mail('en', board('Autumn Storyboard'));
    expect(m.text.split('\n')[0]).toBe('Your storyboard for Autumn is ready.');
    expect(push('en', board('Autumn Storyboard')).body).toBe('The storyboard for Autumn in Spring launch is now available.');
  });

  it('leaves a title that is only the word, or has it in the middle, as it is', () => {
    expect(mail('ko', board('스토리보드')).text.split('\n')[0]).toBe('스토리보드 스토리보드를 확인해 보세요.');
    expect(mail('ko', board('스토리보드 초안 v2')).text.split('\n')[0]).toBe('스토리보드 초안 v2 스토리보드를 확인해 보세요.');
    expect(push('en', board('Storyboard for the autumn film')).body).toBe('The storyboard for Storyboard for the autumn film in Spring launch is now available.');
  });

  it('keeps every other title as it was: a plain board title, and a draft title even with the word in it', () => {
    expect(mail('ko', board('Hero film')).text.split('\n')[0]).toBe('Hero film 스토리보드를 확인해 보세요.');
    const draft: RoomNoticeLine[] = [{ kind: 'new_version', title: '가을 스토리보드', version: 2, name: 'YAGI team' }];
    expect(mail('ko', draft).subject).toBe('[Spring launch] 가을 스토리보드 새 시안이 도착했어요');
  });
});
