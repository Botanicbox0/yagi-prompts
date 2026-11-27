import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      _subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
    ) => getSnapshot(),
  };
});

import {
  MakerBlogEmptyOwnerCta,
  MakerProfileOwnerActions,
} from '@/components/makers/owner-actions';
import {
  makerSessionSnapshot,
  publishMakerSession,
  resetMakerSessionStore,
  subscribeMakerSession,
} from '@/lib/makers/session-store';

describe('Maker profile & blog owner islands through session-store', () => {
  beforeEach(() => {
    resetMakerSessionStore();
  });

  afterEach(() => {
    resetMakerSessionStore();
  });

  it('stays hidden until the session store receives a matching active maker, and notifies subscribers', () => {
    const notifications = vi.fn();
    const unsubscribe = subscribeMakerSession(notifications);

    expect(
      renderToStaticMarkup(
        <MakerProfileOwnerActions
          handle="alpha_demo"
          writeHref="/creators/workspace/posts/new"
          editHref="/creators/workspace#profile"
          labels={{ writePost: '글 쓰기', editProfile: '프로필 수정' }}
        />,
      ),
    ).toBe('');

    publishMakerSession({
      signedIn: true,
      displayName: 'Artist',
      maker: { active: true, handle: 'alpha_demo' },
    });
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(makerSessionSnapshot()).toEqual({
      signedIn: true,
      active: true,
      handle: 'alpha_demo',
    });

    const ownerBtns = renderToStaticMarkup(
      <MakerProfileOwnerActions
        handle="alpha_demo"
        writeHref="/creators/workspace/posts/new"
        editHref="/creators/workspace#profile"
        labels={{ writePost: '글 쓰기', editProfile: '프로필 수정' }}
      />,
    );
    expect(ownerBtns).toContain('data-maker-owner-write');
    expect(ownerBtns).toContain('data-maker-owner-edit');
    expect(ownerBtns).toContain('border-[#09090B]/15');
    expect(ownerBtns).not.toContain('bg-[#09090B]');
    expect(ownerBtns).not.toContain('bg-black');
    expect(ownerBtns).toContain('글 쓰기');
    expect(ownerBtns).toContain('프로필 수정');
    expect(ownerBtns).toContain('href="/creators/workspace/posts/new"');
    expect(ownerBtns).toContain('href="/creators/workspace#profile"');

    expect(
      renderToStaticMarkup(
        <MakerProfileOwnerActions
          handle="other_demo"
          writeHref="/creators/workspace/posts/new"
          editHref="/creators/workspace#profile"
          labels={{ writePost: '글 쓰기', editProfile: '프로필 수정' }}
        />,
      ),
    ).toBe('');

    const firstPostBtn = renderToStaticMarkup(
      <MakerBlogEmptyOwnerCta
        handle="alpha_demo"
        writeHref="/creators/workspace/posts/new"
        label="첫 글 쓰기"
      />,
    );
    expect(firstPostBtn).toContain('data-maker-owner-first-post');
    expect(firstPostBtn).toContain('첫 글 쓰기');
    expect(firstPostBtn).toContain('#FF58AE');

    unsubscribe();
  });
});
