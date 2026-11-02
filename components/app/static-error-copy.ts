/**
 * The one piece of user-facing copy that cannot come from `messages/*.ts` at runtime: the text of
 * `app/global-error.tsx`, which replaces the ROOT layout — when it renders, the layout that
 * resolves the locale (and possibly the module graph) is part of what failed. It is short, calm,
 * and said in both languages because the reader's language is unknown there.
 *
 * `app/(app)/error.tsx` falls back to the same pair only if its dictionary copy is missing.
 */
export const STATIC_ERROR_COPY = {
  ko: {
    title: '페이지를 불러오지 못했습니다.',
    body: '새로고침하면 대부분 해결됩니다. 계속되면 hello@yagiworkshop.xyz로 알려 주세요.',
    reload: '새로고침',
    retry: '다시 시도',
  },
  en: {
    title: 'This page did not load.',
    body: 'Reloading usually fixes it. If it keeps happening, email hello@yagiworkshop.xyz.',
    reload: 'Reload',
    retry: 'Try again',
  },
} as const;
