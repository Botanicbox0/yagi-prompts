import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PromptCreateFeedback } from '@/components/admin/prompt-create-feedback';

const labels = {
  useCase: 'Pick at least one use case',
  poster: 'Upload a poster',
  invalid: 'Invalid form submission',
  upload: 'Upload failed',
  session: 'Session expired',
  uncertain: 'Publish status uncertain',
  retained: 'Inputs retained',
  publishing: 'Publishing...',
  draftRestored: '임시저장 복원됨',
  draftDiscard: '임시저장 비우기',
  draftSavedAt: '저장 시각: {time}',
};

describe('PromptCreateFeedback static render', () => {
  it('renders children and preserves form structure without javascript', () => {
    const html = renderToStaticMarkup(
      <PromptCreateFeedback labels={labels}>
        <form>
          <input type="text" name="title" defaultValue="" />
          <button type="submit">Submit</button>
        </form>
      </PromptCreateFeedback>
    );

    expect(html).toContain('name="title"');
    expect(html).toContain('Submit');
    // On server prerender without localStorage, draft banner is not rendered
    expect(html).not.toContain('data-prompt-draft-banner');
  });
});
