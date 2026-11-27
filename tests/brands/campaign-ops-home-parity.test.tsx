import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { homeLayout } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Campaign ops C1 Fix Round 1 baseline snapshots for WorkspaceHome (components/brand-workspace/home/home-view.tsx),
 * captured BEFORE editing home-view.tsx for teamModeLabel. NEVER regenerate.
 */
vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => null,
}));

const ko = getDictionary('ko');
const ORG = 'a0000000-0000-4000-8000-0000000000a1';

const baseCopy = {
  home: ko.brandHome,
  shell: ko.studioShell,
  roomsNav: ko.roomsShell.nav,
  inbox: ko.roomsChat.inbox,
  prompt: {
    label: ko.brandStudio.dock.label,
    placeholder: { image: ko.brandStudio.dock.placeholder, video: ko.brandStudio.dock.placeholderVideo },
  },
  activeStatus: ko.brandWorkspace.status.active,
  allAssets: ko.studioLibrary.allAssets,
};

describe('WorkspaceHome closed-switch baseline parity', () => {
  it('matches untouched WorkspaceHome markup when closed', () => {
    const layout = homeLayout({
      choice: { id: ORG, role: 'owner', denied: [] },
      flagOn: true,
      canRequest: true,
      rooms: true,
    })!;
    const freshHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName="Alpha fixture"
        locale="ko"
        layout={layout}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        copy={baseCopy}
      />,
    );
    expect(freshHtml).toMatchSnapshot('workspace-home-fresh');

    const activeHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName="Alpha fixture"
        locale="ko"
        layout={layout}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={2}
        readOnly={false}
        copy={baseCopy}
      />,
    );
    expect(activeHtml).toMatchSnapshot('workspace-home-active');
  });
});
